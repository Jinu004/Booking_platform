const express = require('express')
const router = express.Router()
const { parseIncoming, sendMessage, sendButtons } = require('./whatsapp.adapter')
const { successResponse } = require('../../../utils/response')
const logger = require('../../../utils/logger')

router.get('/', (req, res) => {
  const meta = require('./whatsapp.meta')
  const challenge = meta.verifyWebhook(req.query)
  if (challenge) {
    logger.info('Meta webhook verified successfully')
    return res.status(200).send(challenge)
  }
  logger.warn('Meta webhook verification failed')
  return res.status(403).send('Forbidden')
})

router.post('/', async (req, res) => {
  res.status(200).json({ success: true, data: { received: true }, error: null })

  setImmediate(async () => {
    try {
      const body = req.body
      const source = body.object === 'whatsapp_business_account' ? 'meta' : 'waha'
      const message = parseIncoming(body, source)
      if (!message) return

      const redisClient = require('../../../config/redis')
      if (message.messageId && redisClient) {
        const isDuplicate = await redisClient.get(`msg_dedup:${message.messageId}`)
        if (isDuplicate) {
          logger.warn(`Duplicate message detected and skipped: ${message.messageId}`)
          return
        }
        await redisClient.set(`msg_dedup:${message.messageId}`, '1', { EX: 300 })
      }

      logger.info(`Incoming ${source} message from ${message.from}`)

      const TenantService = require('../../tenant/tenant.service')
      let tenant = null

      if (source === 'waha') {
        const tenantId = process.env.WAHA_DEFAULT_TENANT_ID || '262467ed-7cf3-418b-b46c-6038540f9260'
        try {
          tenant = await TenantService.getTenantById(tenantId)
        } catch (err) {
          logger.warn(`No tenant configured for WAHA. Set WAHA_DEFAULT_TENANT_ID in .env`)
          return
        }
        if (!tenant) {
          logger.warn(`No tenant configured for WAHA. Set WAHA_DEFAULT_TENANT_ID in .env`)
          return
        }
      } else {
        tenant = await TenantService.getTenantByWhatsapp(message.to)
        if (!tenant) {
          logger.warn(`No tenant found for number: ${message.from}`)
          return
        }
      }

      const ConversationService = require('../../conversation/conversation.service')
      const context = await ConversationService.handleIncomingMessage(tenant, message)
      logger.info(`Conversation ${context.conversation.id} updated`)

      const HITLModel = require('../../hitl/hitl.model')
      const HITLService = require('../../hitl/hitl.service')
      const convWithMode = await HITLModel.getConversationWithMode(
        context.conversation.id,
        tenant.id
      )
      // Check for TOMORROW booking confirmation
      const redisClient = require('../../../config/redis')
      if (message.message?.trim().toUpperCase() === 'TOMORROW' && redisClient) {
        const pendingKey = `tomorrow_booking:${context.conversation.id}`
        const pendingData = await redisClient.get(pendingKey)
        if (pendingData) {
          const pending = JSON.parse(pendingData)
          await redisClient.del(pendingKey)
          const tomorrow = new Date()
          tomorrow.setDate(tomorrow.getDate() + 1)
          const tomorrowDate = tomorrow.toISOString().split('T')[0]
          // Check doctor leave for tomorrow
          const pool = require('../../../config/database')
          const leaveCheck = await pool.query(
            `SELECT id FROM doctor_leaves WHERE doctor_id = $1 AND leave_date = $2 LIMIT 1`,
            [pending.doctor_id, tomorrowDate]
          )
          if (leaveCheck.rows.length > 0) {
            await sendMessage(message.from, `Sorry, Dr. ${pending.doctor_name} is not available tomorrow. Please contact us during working hours to book with another doctor.`)
            return
          }
          // Check tomorrow token count
          const tokenCountRes = await pool.query(
            `SELECT COUNT(*) AS count FROM bookings WHERE doctor_id = $1 AND booking_date = $2 AND status != 'cancelled'`,
            [pending.doctor_id, tomorrowDate]
          )
          const tomorrowCount = parseInt(tokenCountRes.rows[0].count || 0)
          const doctorRes = await pool.query(`SELECT max_tokens_daily FROM clinic_doctors WHERE id = $1`, [pending.doctor_id])
          const maxTokens = doctorRes.rows[0]?.max_tokens_daily || 30
          if (tomorrowCount >= maxTokens) {
            await sendMessage(message.from, `Sorry, Dr. ${pending.doctor_name} is fully booked for tomorrow as well. Please contact us to explore other options.`)
            return
          }
          // Create tomorrow booking
          const bookingRes = await pool.query(
            `INSERT INTO bookings
               (tenant_id, customer_id, conversation_id, doctor_id,
                source, status, booking_date, token_number, notes, patient_name)
             VALUES ($1, $2, $3, $4, 'whatsapp', 'pending', $5,
               (SELECT COUNT(*) + 1 FROM bookings WHERE doctor_id = $4 AND booking_date = $5 AND status != 'cancelled'),
               $6, $7)
             RETURNING id, token_number`,
            [tenant.id, context.customer?.id || null, context.conversation.id, pending.doctor_id,
             tomorrowDate, `Booked via WhatsApp for ${pending.patient_name}`, pending.patient_name]
          )
          const tokenNumber = bookingRes.rows[0].token_number
          const booking = bookingRes.rows[0]
          await pool.query(
            `INSERT INTO clinic_tokens (tenant_id, booking_id, doctor_id, token_number, status)
             VALUES ($1, $2, $3, $4, 'waiting')`,
            [tenant.id, booking.id, pending.doctor_id, tokenNumber]
          )
          const confirmMsg = `Booking confirmed for tomorrow! 🏥
Token Number: ${tokenNumber}
Doctor: ${pending.doctor_name}
${pending.doctor_specialization}
📅 Date: ${new Date(tomorrowDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
Reply CANCEL to cancel your booking.`
          await sendMessage(message.from, confirmMsg)
          await ConversationService.saveInboundMessage(context.conversation.id, message.message, 'text')
          await ConversationService.saveOutboundMessage(context.conversation.id, confirmMsg, 'assistant')
          return
        }
      }

      if (convWithMode?.mode === 'human') {
        await ConversationService.saveInboundMessage(
          context.conversation.id,
          message.message,
          message.type || 'text'
        )
        HITLService.broadcastIncomingPatientMessage(
          tenant.id,
          context.conversation.id,
          message.message,
          context.customer?.name || message.from
        )
        logger.info(`Conversation ${context.conversation.id} is in human mode — skipping AI`)
        return
      }

      const configs = await TenantService.getAllConfigs(tenant.id)

      let additionalData = {}
      if (tenant.industry === 'clinic') {
        try {
          const pool = require('../../../config/database')
          const doctorsResult = await pool.query(
            `SELECT * FROM clinic_doctors WHERE tenant_id = $1 AND available_today = true`,
            [tenant.id]
          )
          additionalData.doctors = doctorsResult.rows
        } catch (err) {
          logger.warn('Could not load doctors:', err.message)
          additionalData.doctors = []
        }
      }

      await sendMessage(message.from, '⏳ Please wait a moment...')

      const AIService = require('../../ai-engine/ai.service')
      let aiResponse
      let isAIError = false
      let isEscalated = false
      try {
        aiResponse = await AIService.processMessage({
          tenant,
          customer: context.customer,
          conversation: context.conversation,
          recentMessages: context.recentMessages,
          session: context.session,
          configs,
          additionalData
        })


        isAIError = typeof aiResponse === 'object' && aiResponse.error
        if (isAIError) {
          aiResponse = aiResponse.text
        } else if (aiResponse?.escalated) {
          isEscalated = true
          try {
          await HITLService.handleAIHandoffRequest(tenant, { ...context.conversation, customer_phone: context.customer?.phone }, null)
          } catch (hitlErr) {
            logger.error('HITL handoff failed: ' + hitlErr?.message + ' ' + hitlErr?.stack)
          }
          aiResponse = aiResponse.text
        }
      } catch (err) {
       logger.error(`AI processing crashed for ${message.from}: ${err?.message} ${err?.stack}`) 
        aiResponse = 'Sorry, I am having trouble right now. Please try again in a moment or call us directly.'
        isAIError = true
      }


if (!isAIError && !isEscalated) {
  await ConversationService.saveInboundMessage(
    context.conversation.id,
    message.message,
    message.type || 'text'
  )
  HITLService.broadcastToTenant(tenant.id, 'new_message', {
    conversationId: context.conversation.id,
    message: { role: 'user', content: message.message, created_at: new Date().toISOString() }
  })
  await ConversationService.saveOutboundMessage(
    context.conversation.id,
    aiResponse,
    'assistant'
  )
  HITLService.broadcastToTenant(tenant.id, 'new_message', {
    conversationId: context.conversation.id,
    message: { role: 'assistant', content: aiResponse, created_at: new Date().toISOString() }
  })
}

if (!isEscalated) {
  if (aiResponse.includes('How can I help you today')) {
    await sendButtons(
      message.from,
      aiResponse,
      [
        { id: 'book', title: '📅 Book Appointment' },
        { id: 'check', title: '📋 My Booking' },
        { id: 'staff', title: '👤 Talk to Staff' }
      ]
    )
  } else {
    await sendMessage(message.from, aiResponse)
  }
}


    } catch (err) {
      logger.error('Async webhook processing error: ' + err?.message + ' ' + err?.stack)
      const fallbackMessage = 'Sorry, I am having trouble right now. Please try again in a moment or call us directly.'
      if (req.body?.payload?.from) {
        try {
          await sendMessage(req.body.payload.from, fallbackMessage)
        } catch (e) {}
      }
    }
  })
})

module.exports = router

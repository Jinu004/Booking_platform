const express = require('express')
const router = express.Router()
const { parseIncoming, sendMessage, sendButtons } = require('./whatsapp.adapter')
const { executeFunction } = require('../../ai-engine/ai.executor')
const { successResponse } = require('../../../utils/response')
const logger = require('../../../utils/logger')
const crypto = require('crypto');

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
  // Verify X-Hub-Signature-256 for Meta webhooks only
  const signature = req.headers['x-hub-signature-256'];
  const appSecret = process.env.META_APP_SECRET;
  if (appSecret && signature) {
    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', appSecret)
      .update(req.rawBody)
      .digest('hex');
    if (signature !== expectedSignature) {
      logger.warn('Webhook signature mismatch — possible forged request rejected');
      return res.status(403).json({ success: false, error: 'Invalid signature' });
    }
  }

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
        const tenantId = process.env.WAHA_DEFAULT_TENANT_ID
        if (!tenantId) {
          logger.warn('WAHA_DEFAULT_TENANT_ID not set in .env — skipping WAHA message')
          return
        }
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

      // TOMORROW intent interception — read Redis key set when today was fully booked
      // or booking was outside hours. Bypass Gemini entirely for this case.
      if (message.message?.trim().toUpperCase() === 'TOMORROW' && tenant.industry === 'clinic') {
        try {
          const redisClient = require('../../../config/redis')
          const tomorrowKey = `tomorrow_booking:${context.conversation.id}`
          const stored = await redisClient.get(tomorrowKey)
          if (stored) {
            const { doctor_name, patient_name } = JSON.parse(stored)
            await sendMessage(message.from, '⏳ Please wait a moment...')
            const result = await executeFunction(
              'create_tomorrow_booking',
              { doctor_name, patient_name },
              { tenant, customer: context.customer, conversation: context.conversation }
            )
            const responseText = typeof result === 'string' ? result : result?.message || 'Booking processed.'
            const finalText = responseText.startsWith('DIRECT:') ? responseText.slice(7).trim() : responseText
            await sendMessage(message.from, finalText)
            await redisClient.del(tomorrowKey)
            return
          }
        } catch (tomorrowErr) {
          logger.warn('TOMORROW intent lookup failed, falling through to AI:', tomorrowErr.message)
        }
      }

      const configs = await TenantService.getAllConfigs(tenant.id)

      let additionalData = {}
      if (tenant.industry === 'clinic') {
        try {
          const doctorsCacheKey = `available_doctors:${tenant.id}`
          const cachedDoctors = await redisClient.get(doctorsCacheKey)
          if (cachedDoctors) {
            additionalData.doctors = JSON.parse(cachedDoctors)
          } else {
            const pool = require('../../../config/database')
            const doctorsResult = await pool.query(
              `SELECT * FROM clinic_doctors WHERE tenant_id = $1 AND available_today = true`,
              [tenant.id]
            )
            additionalData.doctors = doctorsResult.rows
            try {
              await redisClient.setEx(doctorsCacheKey, 60, JSON.stringify(doctorsResult.rows))
            } catch (cacheErr) {
              logger.warn('Redis set failed for available doctors:', cacheErr.message)
            }
          }
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
        aiResponse = 'Sorry, I could not process that. Reply 1 to Book Today, 2 to Book Tomorrow, 3 to Talk to Staff, 4 to Check Booking.'
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
  await sendMessage(message.from, aiResponse)
}

      // Send clinic contact card on patient's very first message (Meta only)
      if (source === 'meta' && tenant.whatsapp_number) {
        try {
          const pool = require('../../../config/database')
          const flagResult = await pool.query(
            'SELECT contact_card_sent FROM conversations WHERE id = $1',
            [context.conversation.id]
          )
          const alreadySent = flagResult.rows[0]?.contact_card_sent === true
          if (!alreadySent) {
            const { sendContact } = require('./whatsapp.meta')
            const META_TOKEN = process.env.META_WHATSAPP_TOKEN || ''
            const META_PHONE_ID = process.env.META_PHONE_NUMBER_ID || ''
            await sendContact(message.from, tenant.name, tenant.whatsapp_number, META_PHONE_ID, META_TOKEN)
            await pool.query(
              'UPDATE conversations SET contact_card_sent = true WHERE id = $1',
              [context.conversation.id]
            )
          }
        } catch (err) {
          logger.error('Contact card send failed (non-fatal):', JSON.stringify(err.response?.data || err.message))
        }
      }


    } catch (err) {
      logger.error('Async webhook processing error: ' + err?.message + ' ' + err?.stack)
      const fallbackMessage = 'Sorry, I could not process that. Reply 1 to Book Today, 2 to Book Tomorrow, 3 to Talk to Staff, 4 to Check Booking.'
      if (req.body?.payload?.from) {
        try {
          await sendMessage(req.body.payload.from, fallbackMessage)
        } catch (e) {}
      }
    }
  })
})

module.exports = router

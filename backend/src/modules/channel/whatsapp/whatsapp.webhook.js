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
  if (appSecret) {
    if (!signature) {
      logger.warn('Webhook request missing signature header — rejected');
      return res.status(403).json({ success: false, error: 'Missing signature' });
    }
    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', appSecret)
      .update(req.rawBody)
      .digest('hex');
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    const valid = sigBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    if (!valid) {
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

      logger.info(`Incoming ${source} message from ${message.from.toString().slice(0, 2)}XXXXXX${message.from.toString().slice(-3)}`)

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

      // Intercept button replies before Gemini — direct function calls (skip Please wait for these)
      const isButtonReply = ['Book Another Day', 'Talk to Staff', 'Check My Booking', 'Reschedule'].includes(message.message)
      const greetings = ['hi', 'hello', 'hey', 'hii', 'helo', 'hai', 'hiya', 'start', 'menu']
      const isReschedule = message.message?.trim() === 'Reschedule'
      const isGreeting = greetings.includes(message.message?.toLowerCase().trim()) || isReschedule

      if (isGreeting) {
        try {
          const { executeFunction } = require('../../ai-engine/ai.executor')
          const result = await executeFunction('show_welcome', {}, { tenant, customer: context.customer, conversation: context.conversation, latestMessage: message.message, interactiveId: null, doctorProfiles: [] })
          if (typeof result === 'string' && result.startsWith('DIRECT:')) {
            const directContent = result.slice(7).trim()
            if (directContent.startsWith('__INTERACTIVE_SENT__::')) {
              const textContent = directContent.slice('__INTERACTIVE_SENT__::'.length)
              await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
              await ConversationService.saveOutboundMessage(context.conversation.id, textContent, 'assistant')
            } else {
              await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
              await sendMessage(message.from, directContent)
              await ConversationService.saveOutboundMessage(context.conversation.id, directContent, 'assistant')
            }
          }
        } catch (err) {
          logger.error('show_welcome direct call failed:', err.message)
          await sendMessage(message.from, `Hello! Welcome to ${tenant.name} 👋\n\nOops, something went wrong on our end! Please say Hi to try again 😊`)
        }
        return
      }

      if (message.message === 'Book Another Day') {
        try {
          const { executeFunction } = require('../../ai-engine/ai.executor')
          const result = await executeFunction('show_all_doctors', {}, { tenant, customer: context.customer, conversation: context.conversation, latestMessage: message.message, interactiveId: null, doctorProfiles: [] })
          if (typeof result === 'string' && result.startsWith('DIRECT:')) {
            const directContent = result.slice(7).trim()
            if (directContent.startsWith('__INTERACTIVE_SENT__::')) {
              const textContent = directContent.slice('__INTERACTIVE_SENT__::'.length)
              await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
              await ConversationService.saveOutboundMessage(context.conversation.id, textContent, 'assistant')
            } else {
              await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
              await sendMessage(message.from, directContent)
              await ConversationService.saveOutboundMessage(context.conversation.id, directContent, 'assistant')
            }
          }
        } catch (err) {
          logger.error('show_all_doctors direct call failed:', err.message)
          await sendMessage(message.from, 'Sorry, I could not load the doctor list. Please try again.')
        }
        return
      }

      if (message.message === 'Reschedule') {
        try {
          const result = await executeFunction('show_welcome', {}, {
            tenant,
            customer: context.customer,
            conversation: context.conversation,
            latestMessage: message.message,
            interactiveId: null,
            doctorProfiles: []
          })
          if (typeof result === 'string' && result.startsWith('DIRECT:')) {
            const directContent = result.slice(7).trim()
            if (directContent.startsWith('__INTERACTIVE_SENT__::')) {
              const textContent = directContent.slice('__INTERACTIVE_SENT__::'.length)
              await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
              await ConversationService.saveOutboundMessage(context.conversation.id, textContent, 'assistant')
            } else {
              await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
              await sendMessage(message.from, directContent)
              await ConversationService.saveOutboundMessage(context.conversation.id, directContent, 'assistant')
            }
          }
        } catch (err) {
          logger.error('Reschedule direct call failed:', err.message)
          await sendMessage(message.from, 'Sorry, I could not load available doctors. Please say Hi to try again.')
        }
        return
      }

      if (message.message === 'Talk to Staff') {
        try {
          await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
          await HITLService.handleAIHandoffRequest(tenant, { ...context.conversation, customer_phone: context.customer?.phone }, null)
        } catch (err) {
          logger.error('Talk to Staff direct call failed:', err.message)
          await sendMessage(message.from, 'Sorry, I could not connect you to staff. Please try again.')
        }
        return
      }

      if (message.message === 'Check My Booking') {
        try {
          const { executeFunction } = require('../../ai-engine/ai.executor')
          const result = await executeFunction('get_patient_bookings', {}, { tenant, customer: context.customer, conversation: context.conversation, latestMessage: message.message, interactiveId: null, doctorProfiles: [] })
          let responseText = ''
          if (typeof result === 'string' && result.startsWith('DIRECT:')) {
            responseText = result.slice(7).trim()
          } else if (result?.message) {
            responseText = result.message
          }
          if (responseText) {
            await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
            await sendMessage(message.from, responseText)
            await ConversationService.saveOutboundMessage(context.conversation.id, responseText, 'assistant')
          }
        } catch (err) {
          logger.error('get_patient_bookings direct call failed:', err.message)
          await sendMessage(message.from, 'Sorry, I could not retrieve your bookings. Please try again.')
        }
        return
      }

      // Intercept "Book for someone else" tap — ask for name
      if (message.interactiveId === 'patient_new') {
        const newPatientMsg = 'Please reply with the patient\'s name to confirm booking.'
        await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
        await sendMessage(message.from, newPatientMsg)
        await ConversationService.saveOutboundMessage(context.conversation.id, newPatientMsg, 'assistant')
        return
      }

      // Intercept doctor selection from Book Today list (id format: "booktoday_<uuid>")
      if (message.interactiveId && /^booktoday_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(message.interactiveId)) {
        try {
          const { executeFunction } = require('../../ai-engine/ai.executor')
          const result = await executeFunction('check_doctor_availability', { doctor_name: message.message }, { tenant, customer: context.customer, conversation: context.conversation, latestMessage: message.message, interactiveId: message.interactiveId, doctorProfiles: [] })
          if (typeof result === 'string' && result.startsWith('DIRECT:')) {
            const directContent = result.slice(7).trim()
            if (directContent.startsWith('__INTERACTIVE_SENT__::')) {
              const textContent = directContent.slice('__INTERACTIVE_SENT__::'.length)
              await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
              await ConversationService.saveOutboundMessage(context.conversation.id, textContent, 'assistant')
            } else {
              await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
              await sendMessage(message.from, directContent)
              await ConversationService.saveOutboundMessage(context.conversation.id, directContent, 'assistant')
            }
          } else {
            const responseText = result?.message || 'Sorry, something went wrong. Please say Hi to try again.'
            await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
            await sendMessage(message.from, responseText)
            await ConversationService.saveOutboundMessage(context.conversation.id, responseText, 'assistant')
          }
        } catch (err) {
          logger.error('Book Today doctor selection failed:', err.message)
          await sendMessage(message.from, 'Sorry, I could not process that. Please say Hi to try again.')
        }
        return
      }

      // Intercept session selection button taps (id format: "session_<uuid>_HH-MM-SS")
      if (message.interactiveId && /^session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_\d{2}-\d{2}-\d{2}$/.test(message.interactiveId)) {
        try {
          const { executeFunction } = require('../../ai-engine/ai.executor')
          const result = await executeFunction('get_patient_profiles', {}, { tenant, customer: context.customer, conversation: context.conversation, latestMessage: message.message, interactiveId: message.interactiveId, doctorProfiles: [] })
          if (typeof result === 'string' && result.startsWith('DIRECT:')) {
            const directContent = result.slice(7).trim()
            if (directContent.startsWith('__INTERACTIVE_SENT__::')) {
              const textContent = directContent.slice('__INTERACTIVE_SENT__::'.length)
              await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
              await ConversationService.saveOutboundMessage(context.conversation.id, textContent, 'assistant')
            } else if (directContent.startsWith('NEW_PATIENT::')) {
              const askName = 'Please reply with your name to confirm booking.'
              await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
              await sendMessage(message.from, askName)
              await ConversationService.saveOutboundMessage(context.conversation.id, askName, 'assistant')
            }
          }
        } catch (err) {
          logger.error('Session selection patient profiles failed:', err.message)
        }
        return
      }

      // Intercept day selection from get_doctor_schedule list (id format: "DOW::YYYY-MM-DD")
      if (message.interactiveId && /^\d+::\d{4}-\d{2}-\d{2}$/.test(message.interactiveId)) {
        try {
          const { executeFunction } = require('../../ai-engine/ai.executor')
          const result = await executeFunction('get_patient_profiles', {}, { tenant, customer: context.customer, conversation: context.conversation, latestMessage: message.message, interactiveId: message.interactiveId, doctorProfiles: [] })
          if (typeof result === 'string' && result.startsWith('DIRECT:')) {
            const directContent = result.slice(7).trim()
            if (directContent.startsWith('__INTERACTIVE_SENT__::')) {
              const textContent = directContent.slice('__INTERACTIVE_SENT__::'.length)
              await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
              await ConversationService.saveOutboundMessage(context.conversation.id, textContent, 'assistant')
            } else if (directContent.startsWith('NEW_PATIENT::')) {
              const askName = 'Please reply with your name to confirm booking.'
              await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
              await sendMessage(message.from, askName)
              await ConversationService.saveOutboundMessage(context.conversation.id, askName, 'assistant')
            }
          }
        } catch (err) {
          logger.error('Day selection patient profiles failed:', err.message)
        }
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
      // doctors are fetched on-demand via get_available_doctors function call in ai.executor.js

      const AIService = require('../../ai-engine/ai.service')
      let aiResponse
      let isAIError = false
      let isEscalated = false
      let isInteractiveSent = false
      try {
        aiResponse = await AIService.processMessage({
          tenant,
          customer: context.customer,
          conversation: context.conversation,
          recentMessages: context.recentMessages,
          session: context.session,
          configs,
          additionalData,
          interactiveId: message.interactiveId || null
        })


        isAIError = typeof aiResponse === 'object' && aiResponse.error
        isInteractiveSent = typeof aiResponse === 'object' && aiResponse.interactiveSent
        if (isInteractiveSent) {
          aiResponse = aiResponse.text  // use text for DB/Gemini context
        } else if (isAIError) {
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
        const clinicPhone = configs?.business_phone ? ` or call us at ${configs.business_phone}` : ''
        aiResponse = `Sorry, I could not process that. Please say Hi to try again${clinicPhone}.`
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

if (!isEscalated && !isInteractiveSent && aiResponse) {
  await sendMessage(message.from, aiResponse)
}

      // Send clinic contact card after booking confirmation (Meta only)
      const isBookingConfirmation = aiResponse && aiResponse.includes('Booking confirmed')
      if (source === 'meta' && tenant.whatsapp_number && isBookingConfirmation) {
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
      const fallbackMessage = 'Sorry, I could not process that. Please say Hi to try again.'
      const fallbackFrom = req.body?.payload?.from
        || req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from
      if (fallbackFrom) {
        try {
          await sendMessage(fallbackFrom, fallbackMessage)
        } catch (e) {}
      }
    }
  })
})

module.exports = router

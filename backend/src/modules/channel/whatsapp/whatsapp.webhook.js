const express = require('express')
const router = express.Router()
const { parseIncoming, sendMessage, sendButtons } = require('./whatsapp.adapter')
const { successResponse } = require('../../../utils/response')
const logger = require('../../../utils/logger')

/**
 * GET /webhook/whatsapp
 * Meta webhook verification endpoint
 */
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

/**
 * POST /webhook/whatsapp
 * Receives incoming WhatsApp messages
 * Works for both WAHA and Meta payloads
 */
router.post('/', async (req, res) => {
  // Always respond 200 immediately — WhatsApp requirements
  res.status(200).json({ success: true, data: { received: true }, error: null })

  // Process asynchronously so response is never delayed
  setImmediate(async () => {
    try {
      const body = req.body

      // Detect provider from payload structure
      const source = body.object === 'whatsapp_business_account'
        ? 'meta'
        : 'waha'

      // Parse incoming message to standard format
      const message = parseIncoming(body, source)
      if (!message) return

      // Deduplication check
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

      // Identify tenant from WhatsApp number
      const TenantService = require('../../tenant/tenant.service')
      let tenant = null;

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

      // Process through conversation service (saves message, manages session)
      const ConversationService = require('../../conversation/conversation.service')
      const context = await ConversationService.handleIncomingMessage(tenant, message)

      logger.info(`Conversation ${context.conversation.id} updated`)

      // ── HITL Mode Check ──────────────────────────────────────────────
      const HITLModel = require('../../hitl/hitl.model')
      const HITLService = require('../../hitl/hitl.service')
      const convWithMode = await HITLModel.getConversationWithMode(
        context.conversation.id,
        tenant.id
      )
      if (convWithMode?.mode === 'human') {
        // Save patient message since we are skipping AI processing
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
      // ── End HITL Check ───────────────────────────────────────────────

      // Load tenant configs for AI prompt
      const configs = await TenantService.getAllConfigs(tenant.id)

      // Load additional data for clinic (available doctors today)
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

      // Send typing indicator to user
      await sendMessage(message.from, '⏳ Please wait a moment...')

      // Process through Gemini AI
      const AIService = require('../../ai-engine/ai.service')
      let aiResponse;
      let isAIError = false;
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
        isAIError = typeof aiResponse === 'object' && aiResponse.error;
        if (isAIError) { aiResponse = aiResponse.text; }
        logger.info(`AI response for ${message.from}: ${aiResponse.substring(0, 100)}`)
      } catch (err) {
        logger.error(`AI processing crashed for ${message.from}:`, err.message)
        aiResponse = 'Sorry, I am having trouble right now. Please try again in a moment or call us directly.'
        isAIError = true;
      }

      // Save messages to database ONLY if AI succeeds
      if (!isAIError) {
        await ConversationService.saveInboundMessage(
          context.conversation.id,
          message.message,
          message.type || 'text'
        )

        await ConversationService.saveOutboundMessage(
          context.conversation.id,
          aiResponse,
          'assistant'
        )
      }

      // Send via WhatsApp with built-in human-like delay
      
      // Check if this is a greeting response
      // Greeting responses contain the welcome text
      if (aiResponse.includes('How can I help you today')) {
        // Send interactive buttons instead of plain text
        await sendButtons(
          message.from,
          aiResponse,
          [
            { id: 'book', title: '📅 Book Appointment' },
            { id: 'check', title: '📋 My Booking' },
            { id: 'staff', title: '👤 Talk to Staff' }
          ]
        )
      } else if (aiResponse.includes('Which doctor would you like')) {
        // Parse doctor list from AI response
        // Send as list message
        // For now send as plain text — doctor list
        // interactive will be added in next sprint
        await sendMessage(message.from, aiResponse)
      } else {
        // Regular text response
        await sendMessage(message.from, aiResponse)
      }

    } catch (err) {
      logger.error('Async webhook processing error:', err.message)
      const fallbackMessage = 'Sorry, I am having trouble right now. Please try again in a moment or call us directly.'
      
      if (req.body?.payload?.from) {
        try { 
           await sendMessage(req.body.payload.from, fallbackMessage) 
        } catch(e){}
      }
    }
  })
})

module.exports = router


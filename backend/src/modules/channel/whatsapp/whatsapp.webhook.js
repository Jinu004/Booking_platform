const express = require('express')
const router = express.Router()
const { parseIncoming } = require('./whatsapp.adapter')
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

      logger.info(`Incoming ${source} message from ${message.from}`)

      // Identify tenant from WhatsApp number
      const TenantService = require('../../tenant/tenant.service')
      const tenant = await TenantService.getTenantByWhatsapp(message.from)

      if (!tenant) {
        logger.warn(`No tenant found for number: ${message.from}`)
        return
      }

      // Process through conversation service (saves message, manages session)
      const ConversationService = require('../../conversation/conversation.service')
      const context = await ConversationService.handleIncomingMessage(tenant, message)

      logger.info(`Conversation ${context.conversation.id} updated`)

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

      // Process through Gemini AI
      const AIService = require('../../ai-engine/ai.service')
      const aiResponse = await AIService.processMessage({
        tenant,
        customer: context.customer,
        conversation: context.conversation,
        recentMessages: context.recentMessages,
        session: context.session,
        configs,
        additionalData
      })

      // Save AI response to database
      await ConversationService.saveOutboundMessage(
        context.conversation.id,
        aiResponse,
        'assistant'
      )

      // Send via WhatsApp with built-in human-like delay
      const { sendMessage } = require('./whatsapp.adapter')
      await sendMessage(message.from, aiResponse)

      logger.info(
        `Gemini responded to ${message.from}: ${aiResponse.substring(0, 80)}...`
      )

    } catch (err) {
      logger.error('Async webhook processing error:', err.message)
    }
  })
})

module.exports = router


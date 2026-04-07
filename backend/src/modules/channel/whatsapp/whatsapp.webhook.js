const express = require('express')
const router = express.Router()
const { parseIncoming } = require('./whatsapp.adapter')
const { identifyTenant } = require('../../tenant/tenant.middleware')
const { getOrCreateSession, updateSession } =
  require('../../conversation/conversation.session')
const { successResponse, errorResponse } =
  require('../../../utils/response')
const logger = require('../../../utils/logger')

/**
 * GET /webhook/whatsapp
 * Meta webhook verification endpoint
 * Meta calls this to verify our webhook URL
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
  try {
    const body = req.body

    // Detect provider from payload structure
    const source = body.object === 'whatsapp_business_account'
      ? 'meta'
      : 'waha'

    // Parse incoming message to standard format
    const message = parseIncoming(body, source)

    if (!message) {
      return successResponse(res, { received: true })
    }

    logger.info(
      `Incoming ${source} message from ${message.from}`
    )

    // Identify tenant from phone number
    const TenantService = require('../../tenant/tenant.service')
    const tenant = await TenantService
      .getTenantByWhatsapp(message.from)

    if (!tenant) {
      logger.warn(
        `No tenant found for number: ${message.from}`
      )
      return successResponse(res, { received: true })
    }

    // Load or create conversation session
    const session = await getOrCreateSession(
      tenant.id,
      message.from
    )

    // Update session with new message
    await updateSession(tenant.id, message.from, {
      messageCount: (session.messageCount || 0) + 1,
      lastMessage: message.message,
      lastMessageAt: new Date().toISOString()
    })

    // Process message through conversation service
    const ConversationService = require('../../conversation/conversation.service')
    
    const context = await ConversationService.handleIncomingMessage(tenant, message)
    
    // TODO Sprint 3 — pass context to AI engine here
    // context contains: conversation, customer,
    // recentMessages, session
    logger.info(
      `Conversation ${context.conversation.id} updated`
    )

    // Always return 200 to WhatsApp immediately
    // Processing happens asynchronously
    return successResponse(res, { received: true })

  } catch (err) {
    logger.error('Webhook error:', err.message)
    // Always return 200 to WhatsApp even on error
    // Otherwise WhatsApp retries indefinitely
    return successResponse(res, { received: true })
  }
})

module.exports = router

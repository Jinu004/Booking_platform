const express = require('express')
const router = express.Router()
const { parseIncoming, sendMessage, sendButtons } = require('./whatsapp.adapter')
const { executeFunction } = require('../../ai-engine/ai.executor')
const { successResponse } = require('../../../utils/response')
const logger = require('../../../utils/logger')
const { maskPhone } = require('../../../utils/phone')
const crypto = require('crypto');

// Typed-name validation for the code booking flow. The cleaning below is the same rule
// create_token_booking applies to patient_name, so the validated name is what gets stored.
const NAME_STOP_WORDS = new Set(['hi', 'hello', 'hey', 'menu', 'book', 'cancel', 'yes', 'no', 'ok', 'okay', 'thanks', 'thank you', 'tomorrow', 'today'])
// Whole words that mark typed text as a question or request rather than a name
const NAME_BLOCKED_WORDS = new Set(['what', 'when', 'where', 'how', 'why', 'who', 'which', 'time', 'timing', 'timings', 'open', 'close', 'closed', 'hours', 'doctor', 'appointment', 'book', 'booking', 'cancel', 'reschedule', 'fee', 'fees', 'price', 'address', 'location', 'available', 'availability', 'please', 'help', 'want', 'need', 'can', 'could', 'do', 'does', 'is', 'are', 'will', 'today', 'tomorrow', 'token', 'clinic', 'hospital'])
function validatePatientName(text) {
  const typed = (text || '').trim()
  if (!typed || typed.includes('?')) return null
  const words = typed.split(/\s+/)
  if (words.length > 4) return null
  if (words.some(w => NAME_BLOCKED_WORDS.has(w.toLowerCase().replace(/^[.'’-]+|[.'’-]+$/g, '')))) return null
  // Letters (Latin, Malayalam U+0D00-U+0D7F), spaces, hyphens, dots, apostrophes only; digits are rejected
  if (!/^[a-zA-Z\sഀ-ൿ.'’-]+$/.test(typed)) return null
  if (NAME_STOP_WORDS.has(typed.toLowerCase().replace(/\s+/g, ' '))) return null
  const cleaned = typed
    .replace(/[^a-zA-Z\sഀ-ൿ-]/g, '')
    .trim()
    .slice(0, 100)
    .replace(/\b\w/g, c => c.toUpperCase())
  const letterCount = (cleaned.match(/[a-zA-Zഀ-ൿ]/g) || []).length
  if (letterCount < 2 || cleaned.length < 2 || cleaned.length > 60) return null
  return { typed, cleaned }
}

// Used only after validatePatientName accepted the text: true when the text is very likely a real name,
// so it can be booked without asking for confirmation. Latin letters only, 2 or 3 words, one word of 3+ letters.
function isConfidentName(typed) {
  const t = (typed || '').trim()
  if (!/^[a-zA-Z\s.'’-]+$/.test(t)) return false
  const words = t.split(/\s+/)
  if (words.length < 2 || words.length > 3) return false
  return words.some(w => (w.match(/[a-zA-Z]/g) || []).length >= 3)
}

// Coexistence: how long a conversation stays in human mode after the clinic replies from the WhatsApp Business app.
// hitl.cron.js resets a human conversation one minute after mode_changed_at, so an echo stores mode_changed_at in the
// future (now + this many minutes - 1 minute); the cron then leaves it alone until this long after the last echo.
const ECHO_HUMAN_MODE_MINUTES = 10

// A staff reply sent from the WhatsApp Business app (smb_message_echoes): store it as a staff message and keep the AI paused.
// Never runs the AI, never writes the Redis session, and never creates a message from the patient.
async function handleStaffEcho(event) {
  const pool = require('../../../config/database')
  const redisClient = require('../../../config/redis')
  const ConversationService = require('../../conversation/conversation.service')
  const ConversationModel = require('../../conversation/conversation.model')
  const CRMModel = require('../../crm/crm.model')
  const CRMService = require('../../crm/crm.service')
  const HITLService = require('../../hitl/hitl.service')
  const { broadcastToTenant: broadcastSse } = require('../../hitl/sse')

  const tenantRes = await pool.query(
    'SELECT id, name, slug, industry, plan, status, whatsapp_number, whatsapp_phone_number_id FROM tenants WHERE whatsapp_phone_number_id = $1 LIMIT 1',
    [event.phoneNumberId]
  )
  const tenant = tenantRes.rows[0]
  if (!tenant) {
    logger.warn('COEXISTENCE_ECHO result=no_tenant (unknown phone number id)')
    return
  }
  // Tenant kill switch: nothing is stored and human mode is not changed for a tenant that is not active
  if (tenant.status !== 'active') {
    logger.info(`TENANT_OFF tenant=${tenant.id} status=${tenant.status} result=ignored`)
    return
  }

  for (const echo of event.echoes) {
    let conversationIdForLog = 'none'
    const logEcho = (result) => logger.info(`COEXISTENCE_ECHO tenant=${tenant.id} conv=${conversationIdForLog} type=${echo.echoType} result=${result}`)
    try {
      // Same dedupe approach as inbound messages, keyed by the echo's wamid
      if (redisClient) {
        const seen = await redisClient.get(`msg_dedup:${echo.wamid}`)
        if (seen) { logEcho('duplicate'); continue }
        await redisClient.set(`msg_dedup:${echo.wamid}`, '1', { EX: 300 })
      }

      // Deleted or edited messages: only logged for now
      if (echo.echoType === 'revoke' || echo.echoType === 'edit') { logEcho('ignored'); continue }

      const content = echo.echoType === 'text'
        ? echo.text
        : `[${String(echo.echoType).replace(/[^a-z_]/gi, '') || 'message'}]`
      if (!content) { logEcho('ignored'); continue }

      // Find the patient and the open conversation; create them if the clinic messaged first (no AI, no Redis session)
      let customer = await CRMModel.getCustomerByPhone(pool, tenant.id, echo.customerPhone)
      if (!customer) customer = await CRMService.findOrCreateCustomer(tenant.id, echo.customerPhone, '')
      let conversation = await ConversationModel.getActiveConversation(pool, tenant.id, customer.id)
      if (!conversation) {
        conversation = await ConversationModel.createConversation(pool, tenant.id, customer.id, 'whatsapp')
        broadcastSse(tenant.id, 'new_conversation', { conversationId: conversation.id, timestamp: new Date().toISOString() })
      }
      conversationIdForLog = conversation.id

      // The messages table has no wamid column, so a reply our own system sent a moment ago is recognised by its text
      if (echo.echoType === 'text') {
        const own = await pool.query(
          `SELECT 1 FROM messages WHERE conversation_id = $1 AND role IN ('assistant', 'staff') AND content = $2
           AND created_at > NOW() - INTERVAL '2 minutes' LIMIT 1`,
          [conversation.id, content]
        )
        if (own.rows.length) { logEcho('own_send'); continue }
      }

      const saved = await ConversationService.saveOutboundMessage(conversation.id, content, 'staff')
      await ConversationModel.touchConversation(pool, tenant.id, conversation.id)

      // Human mode with a long expiry: reuse mode_changed_at, which the hitl cron compares to NOW() - 1 minute
      await pool.query(
        `UPDATE conversations
         SET mode = 'human', mode_changed_at = NOW() + ($3::int * INTERVAL '1 minute')
         WHERE id = $1 AND tenant_id = $2`,
        [conversation.id, tenant.id, ECHO_HUMAN_MODE_MINUTES - 1]
      )

      HITLService.broadcastToTenant(tenant.id, 'new_message', {
        conversationId: conversation.id,
        message: { id: saved?.id, role: 'staff', content, created_at: new Date().toISOString() }
      })
      HITLService.broadcastToTenant(tenant.id, 'mode_changed', {
        conversationId: conversation.id,
        mode: 'human',
        timestamp: new Date().toISOString()
      })
      logEcho('stored')
    } catch (echoErr) {
      logger.error(`COEXISTENCE_ECHO tenant=${tenant.id} conv=${conversationIdForLog} type=${echo.echoType} result=error ${echoErr?.message}`)
    }
  }
}

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

// Production must never accept an unsigned webhook. Said once at startup: without the app secret every POST is rejected.
if (process.env.NODE_ENV === 'production' && !process.env.META_APP_SECRET) {
  logger.error('WEBHOOK_CONFIG META_APP_SECRET is not set in production: every WhatsApp webhook POST will be rejected until it is set');
}

router.post('/', async (req, res) => {
  // Verify X-Hub-Signature-256. In production EVERY payload needs a valid Meta signature, whatever its shape;
  // outside production only Meta-shaped payloads are checked (so the WAHA development flow keeps working).
  const signature = req.headers['x-hub-signature-256'];
  const appSecret = process.env.META_APP_SECRET;
  const isMetaPayload = req.body?.object === 'whatsapp_business_account';
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && !appSecret) {
    logger.error('META_APP_SECRET not set — rejecting webhook');
    return res.status(503).json({ success: false, error: 'Webhook not configured' });
  }
  if (appSecret && (isProduction || isMetaPayload)) {
    // The raw body is the exact bytes received (captured by the JSON parser's verify hook in index.js, never re-serialised)
    if (!signature || !Buffer.isBuffer(req.rawBody)) {
      logger.warn(`WEBHOOK_REJECTED_UNSIGNED ip=${req.ip} reason=${signature ? 'no_raw_body' : 'missing_signature'}`);
      return res.status(403).json({ success: false, error: 'Missing signature' });
    }
    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', appSecret)
      .update(req.rawBody)
      .digest('hex');
    const sigBuffer = Buffer.from(String(signature));
    const expectedBuffer = Buffer.from(expectedSignature);
    const valid = sigBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    if (!valid) {
      logger.warn(`WEBHOOK_REJECTED_UNSIGNED ip=${req.ip} reason=invalid_signature`);
      return res.status(403).json({ success: false, error: 'Invalid signature' });
    }
  }

  res.status(200).json({ success: true, data: { received: true }, error: null })

  setImmediate(async () => {
    const senderContext = require('./senderContext')
    const incomingPhoneId = req.body?.object === 'whatsapp_business_account'
      ? req.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id
      : null
    await senderContext.run(incomingPhoneId, async () => {
    try {
      const body = req.body

      // Coexistence: log-only capture of the payload shape of history, smb_app_state_sync and account_update (all entries and changes)
      try {
        const { captureCoexistenceEvent } = require('./whatsapp.coexistence.capture')
        if (body?.object === 'whatsapp_business_account' && Array.isArray(body.entry)) {
          for (const captureEntry of body.entry) {
            for (const captureChange of (Array.isArray(captureEntry?.changes) ? captureEntry.changes : [])) {
              if (['history', 'smb_app_state_sync', 'account_update'].includes(captureChange?.field)) {
                try {
                  await captureCoexistenceEvent(captureEntry, captureChange)
                } catch {}
              }
            }
          }
        } else if (body && typeof body === 'object' && !Array.isArray(body.entry)
          && (Array.isArray(body.errors) || (Array.isArray(body.history) && body.history.some(h => h && h.errors)))) {
          // The documented history decline has no entry wrapper
          const topKeys = Object.keys(body).slice(0, 20).map(k => String(k).replace(/[^A-Za-z0-9_]/g, '').slice(0, 40)).join(',')
          logger.info(`COEXISTENCE_CAPTURE field=history result=no_entry_wrapper keys=${topKeys}`)
        }
      } catch {}

      // Failed delivery status updates are recorded in send_failures (not awaited, never throws)
      require('./whatsapp.statuses').handleStatusUpdates(body)
        .catch(statusErr => logger.warn(`Status update handling failed: ${String(statusErr?.message || '').slice(0, 120)}`))

      // Template approval, rejection and pause events (not awaited, never throws). Such a payload has no messages,
      // so parseIncoming below returns nothing for it and the handler ends.
      require('./whatsapp.templates.webhook').handleTemplateStatusUpdates(body)
        .catch(templateErr => logger.warn(`Template status handling failed: ${String(templateErr?.message || '').slice(0, 120)}`))

      const source = body.object === 'whatsapp_business_account' ? 'meta' : 'waha'
      // The WAHA development path does not exist in production, whatever WAHA_DEFAULT_TENANT_ID says
      if (source === 'waha' && process.env.NODE_ENV === 'production') {
        logger.warn('WEBHOOK_WAHA_IGNORED_IN_PRODUCTION')
        return
      }
      const message = parseIncoming(body, source)
      if (!message) return

      // Coexistence: replies the clinic sent from the WhatsApp Business app never go through the AI path below
      if (message.type === 'echo') {
        await handleStaffEcho(message)
        return
      }

      const redisClient = require('../../../config/redis')
      if (message.messageId && redisClient) {
        const isDuplicate = await redisClient.get(`msg_dedup:${message.messageId}`)
        if (isDuplicate) {
          logger.warn(`Duplicate message detected and skipped: ${message.messageId}`)
          return
        }
        await redisClient.set(`msg_dedup:${message.messageId}`, '1', { EX: 300 })
      }

      logger.info(`Incoming ${source} message from ${maskPhone(message.from)}`)

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
        // The clinic is found by the Meta phone number id first (unique per clinic), then by the display number
        const tenantById = await TenantService.getTenantByPhoneNumberId(incomingPhoneId)
        let tenantByNumber = null
        try {
          tenantByNumber = await TenantService.getTenantByWhatsapp(message.to)
        } catch (lookupErr) {
          tenantByNumber = null
        }
        tenant = tenantById || tenantByNumber
        if (tenantById && tenantByNumber && tenantById.id !== tenantByNumber.id) {
          logger.warn(`TENANT_LOOKUP_MISMATCH by_phone_number_id=${tenantById.id} by_display_number=${tenantByNumber.id} (using phone_number_id)`)
        }
        if (!tenant) {
          logger.warn(`No tenant found for display number ${maskPhone(message.to)} phone_number_id=${incomingPhoneId || 'none'} (sender ${maskPhone(message.from)})`)
          return
        }
      }

      // Tenant kill switch: only an active tenant gets replies (the webhook still answers 200 to Meta)
      if (tenant.status !== 'active') {
        logger.info(`TENANT_OFF tenant=${tenant.id} status=${tenant.status} result=ignored`)
        return
      }

      // Replies to this message use the clinic's own Meta token when it has one (the shared token otherwise)
      if (source === 'meta') await senderContext.setTenantAccessToken(tenant.id)

      const ConversationService = require('../../conversation/conversation.service')
      const context = await ConversationService.handleIncomingMessage(tenant, message)
      logger.info(`Conversation ${context.conversation.id} updated`)

      // Marketing consent keywords (STOP, SUBSCRIBE, ...) are answered here, in every mode (also human mode), before the AI or any flow.
      // Exact whole-message matches only, for real text messages of a known customer.
      const Consent = require('../../consent/consent.service')
      // A template quick-reply ("Stop offers") arrives as type 'button' with its text in message.message; other buttons match no keyword and fall through.
      if ((message.type === 'text' || message.type === 'button') && !message.interactiveId && context.customer?.id) {
        const consentKeyword = Consent.keywordValue(message.message)
        if (consentKeyword) {
          await Consent.handleChoice({
            tenant,
            context,
            message,
            value: consentKeyword,
            source: message.type === 'button' && consentKeyword === 'none' ? 'stop_button' : 'stop_keyword',
            kind: consentKeyword === 'none' ? 'stop' : 'subscribe'
          })
          return
        }
      }

      // Consent buttons (consent_all, consent_checkups, consent_none): stored and answered here, in every mode (also human mode),
      // without touching the booking flow state, Redis state or the AI. Unknown consent_ ids are ignored silently.
      if (message.interactiveId && String(message.interactiveId).startsWith('consent_')) {
        const buttonChoice = Consent.buttonValue(message.interactiveId)
        if (buttonChoice && context.customer?.id) {
          await Consent.handleChoice({ tenant, context, message, value: buttonChoice, source: 'whatsapp_button' })
        }
        return
      }

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

      // code_booking_flow flag (cached 60s via getAllConfigs); read lazily, once per message
      const CodeFlow = require('../../conversation/conversation.flow')
      let codeFlowOnCache = null
      const isCodeFlowOn = async () => {
        if (codeFlowOnCache === null) {
          try {
            const flagConfigs = await TenantService.getAllConfigs(tenant.id)
            codeFlowOnCache = flagConfigs?.code_booking_flow === 'true'
          } catch (flagErr) {
            logger.warn('code_booking_flow config read failed, treating as off:', flagErr.message)
            codeFlowOnCache = false
          }
        }
        return codeFlowOnCache
      }

      // ---- Code flow: typed new-patient name helpers (used by the text branch and the two button handlers) ----
      const logName = (result, extra = '', confidence = null) => logger.info(`CODE_BOOKING_FLOW step=new_name${confidence ? ` confidence=${confidence}` : ''} result=${result}${extra} tenant=${tenant.id} conversation=${context.conversation.id}`)
      const saveNameInbound = async () => {
        await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
        HITLService.broadcastToTenant(tenant.id, 'new_message', {
          conversationId: context.conversation.id,
          message: { role: 'user', content: message.message, created_at: new Date().toISOString() }
        })
      }
      const sendNameReply = async (text) => {
        await sendMessage(message.from, text)
        await ConversationService.saveOutboundMessage(context.conversation.id, text, 'assistant')
        HITLService.broadcastToTenant(tenant.id, 'new_message', {
          conversationId: context.conversation.id,
          message: { role: 'assistant', content: text, created_at: new Date().toISOString() }
        })
      }
      const sendNameWelcome = async () => {
        try {
          const welcome = await executeFunction('show_welcome', {}, { tenant, customer: context.customer, conversation: context.conversation, latestMessage: message.message, interactiveId: null, doctorProfiles: [] })
          const welcomeContent = typeof welcome === 'string' && welcome.startsWith('DIRECT:') ? welcome.slice(7).trim() : ''
          if (welcomeContent.startsWith('__INTERACTIVE_SENT__::')) {
            await ConversationService.saveOutboundMessage(context.conversation.id, welcomeContent.slice('__INTERACTIVE_SENT__::'.length), 'assistant')
          } else if (welcomeContent) {
            await sendMessage(message.from, welcomeContent)
            await ConversationService.saveOutboundMessage(context.conversation.id, welcomeContent, 'assistant')
          }
        } catch (welcomeErr) {
          logger.warn('Sending welcome from code name flow failed (non-fatal):', welcomeErr.message)
        }
      }
      // Stores the name step in the flow, keeping doctor, session, date and the normal 30 minute expiry
      // Keeps the flow's own kind: 'today' (default) keeps its session, 'tomorrow' has a date and no session
      const storeNameStep = (step, flowData, attempts, pendingName) => {
        const nameFlowKind = flowData.kind === 'tomorrow' ? 'tomorrow' : 'today'
        return CodeFlow.setFlow(tenant.id, message.from, {
          state: 'choose_patient',
          step,
          kind: nameFlowKind,
          doctorId: flowData.doctorId,
          doctorName: flowData.doctorName,
          date: flowData.date,
          sessionStart: nameFlowKind === 'today' ? flowData.sessionStart : null,
          attempts,
          pendingName: pendingName || null
        })
      }
      // Asks the patient to confirm the typed name before anything is booked
      const sendNameConfirm = async (flowData, validated, attempts) => {
        await storeNameStep('confirm_new_name', flowData, attempts, validated.typed)
        const confirmBody = `Book for *${validated.cleaned}*?`
        try {
          await sendButtons(message.from, confirmBody, [
            { id: 'newname_yes', title: 'Yes, book' },
            { id: 'newname_change', title: 'Change name' }
          ])
          await ConversationService.saveOutboundMessage(context.conversation.id, confirmBody, 'assistant')
          HITLService.broadcastToTenant(tenant.id, 'new_message', {
            conversationId: context.conversation.id,
            message: { role: 'assistant', content: confirmBody, created_at: new Date().toISOString() }
          })
          logName('confirm_sent', '', 'low')
        } catch (btnErr) {
          logger.warn('Confirm buttons failed, asking for the name again:', btnErr.message)
          await storeNameStep('await_new_name', flowData, attempts, null)
          await sendNameReply("Sorry, something went wrong. Please reply with the patient's full name again.")
          logName('confirm_failed')
        }
      }
      // Books the confirmed name: lock, create_token_booking, send and save, contact card, clearFlow. Never calls Gemini.
      const runNameBooking = async (flowData, patientName, confidence = null) => {
        const isTomorrowName = flowData.kind === 'tomorrow'
        if (isTomorrowName) {
          // Tomorrow list used after the date moved on (for example after midnight IST): do not book
          const istNowName = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
          istNowName.setDate(istNowName.getDate() + 1)
          const istTomorrowName = `${istNowName.getFullYear()}-${String(istNowName.getMonth() + 1).padStart(2, '0')}-${String(istNowName.getDate()).padStart(2, '0')}`
          if (flowData.date !== istTomorrowName) {
            await saveNameInbound()
            await CodeFlow.clearFlow(tenant.id, message.from)
            await sendNameReply('This list has expired. Say Hi to start again.')
            logName('fallback', ' reason=date_changed', confidence)
            return
          }
        }
        const nameCtx = { tenant, customer: context.customer, conversation: context.conversation, latestMessage: message.message, interactiveId: null, doctorProfiles: [] }
        const nameLockKey = `codebooking:lock:${tenant.id}:${message.from}`
        let nameLockRedis = null
        let nameLockHeld = false
        try {
          nameLockRedis = require('../../../config/redis')
          nameLockHeld = (await nameLockRedis.set(nameLockKey, '1', { NX: true, EX: 30 })) === 'OK'
        } catch (lockErr) {
          logger.warn('code_booking_flow name lock failed:', lockErr.message)
        }
        if (!nameLockHeld) {
          logName('duplicate_tap', '', confidence)
          return
        }
        try {
          let outText = ''
          let outcome = 'business_reply'
          try {
            const nameResult = isTomorrowName
              ? await executeFunction(
                  'create_tomorrow_booking',
                  { doctor_id: flowData.doctorId, patient_name: patientName },
                  nameCtx
                )
              : await executeFunction(
                  'create_token_booking',
                  { doctor_id: flowData.doctorId, session_start_time: flowData.sessionStart, patient_name: patientName },
                  nameCtx
                )
            if (typeof nameResult === 'string' && nameResult.startsWith('DIRECT:')) {
              outText = nameResult.slice(7).trim()
              outcome = outText.includes('Booking confirmed') ? 'success' : 'business_reply'
            } else if (typeof nameResult === 'string' && nameResult.trim()) {
              outText = nameResult.trim()
            } else if (nameResult && nameResult.success === false && nameResult.message) {
              outText = String(nameResult.message)
            } else {
              outcome = 'error'
            }
          } catch (nameBookErr) {
            logger.error('Code-only new-patient booking failed: ' + nameBookErr?.message)
            outcome = 'error'
          }

          await saveNameInbound()
          if (outcome === 'error') {
            // Never fall back to Gemini after the booking function ran: it could double-book
            outText = 'Sorry, I could not complete your booking. Please tap Book Appointment to try again, or tap Talk to Staff.'
          }
          await sendNameReply(outText)
          if (outcome === 'error') await sendNameWelcome()

          // Same contact card as the AI path, once per conversation
          if (source === 'meta' && tenant.whatsapp_number && outText.includes('Booking confirmed')) {
            try {
              const pool = require('../../../config/database')
              const flagResult = await pool.query('SELECT contact_card_sent FROM conversations WHERE id = $1', [context.conversation.id])
              if (flagResult.rows[0]?.contact_card_sent !== true) {
                const { sendContact } = require('./whatsapp.meta')
                await sendContact(message.from, tenant.name, tenant.whatsapp_number)
                await pool.query('UPDATE conversations SET contact_card_sent = true WHERE id = $1', [context.conversation.id])
              }
            } catch (cardErr) {
              logger.error('Contact card send failed (non-fatal):', JSON.stringify(cardErr.response?.data || cardErr.message))
            }
          }

          // Marketing consent question, once per customer, after the confirmed booking (never delays or breaks the booking)
          if (source === 'meta' && outText.includes('Booking confirmed')) {
            Consent.askConsentOnce(tenant, context.customer?.id, message.from, tenant.name, context.conversation.id).catch(() => {})
          }

          if (outcome === 'success') {
            // Keep the list usable: back to the base state of the same list (no step, attempts 0, no pending name)
            await storeNameStep(null, flowData, 0, null)
          } else {
            await CodeFlow.clearFlow(tenant.id, message.from)
          }
          logName(outcome, '', confidence)
        } finally {
          try { await nameLockRedis.del(nameLockKey) } catch (unlockErr) { logger.warn('code_booking_flow name lock release failed:', unlockErr.message) }
        }
      }

      // Intercept button replies before Gemini — direct function calls (skip Please wait for these)
      const isButtonReply = ['Book Another Day', 'Talk to Staff', 'Check My Booking', 'Reschedule'].includes(message.message)
      const greetings = ['hi', 'hello', 'hey', 'hii', 'helo', 'hai', 'hiya', 'start', 'menu']
      const isReschedule = message.message?.trim() === 'Reschedule'
      const isBookAppointment = message.message?.trim() === 'Book Appointment'
      const isGreeting = greetings.includes(message.message?.toLowerCase().trim()) || isBookAppointment

      if (isGreeting) {
        if (await isCodeFlowOn()) await CodeFlow.clearFlow(tenant.id, message.from)
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
        if (await isCodeFlowOn()) await CodeFlow.clearFlow(tenant.id, message.from)
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
        if (await isCodeFlowOn()) await CodeFlow.clearFlow(tenant.id, message.from)
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
        if (await isCodeFlowOn()) await CodeFlow.clearFlow(tenant.id, message.from)
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
        if (await isCodeFlowOn()) await CodeFlow.clearFlow(tenant.id, message.from)
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

      // Code-only "today" booking when the patient taps their name (per-clinic flag code_booking_flow, default off).
      // Falls through to the AI path unless the flag is on and a live choose_patient/today flow exists.
      const patientTapMatch = (message.interactiveId || '').match(/^patient_([0-9a-fA-F-]{36})$/)
      if (patientTapMatch) {
        let codeFlowOn = false
        try {
          const codeFlowConfigs = await TenantService.getAllConfigs(tenant.id)
          codeFlowOn = codeFlowConfigs?.code_booking_flow === 'true'
        } catch (cfgErr) {
          logger.warn('code_booking_flow config read failed, using AI path:', cfgErr.message)
        }
        if (codeFlowOn) {
          const { getFlow, clearFlow } = require('../../conversation/conversation.flow')
          const patientTapId = patientTapMatch[1]
          const flow = await getFlow(tenant.id, message.from)
          // Tomorrow flows use their own log step and done-marker key, so a today booking never blocks them
          const isTomorrowFlow = !!flow && flow.state === 'choose_patient' && flow.data?.kind === 'tomorrow'
          // Future-date flows (Book Another Day, single-session day) are bookable only with doctor, date and session known
          const isFutureFlow = !!flow && flow.state === 'choose_patient' && flow.data?.kind === 'future' &&
            !!flow.data.doctorId && !!flow.data.date && !!flow.data.sessionStart
          const bookStep = isTomorrowFlow ? 'book_tomorrow' : (isFutureFlow ? 'book_future' : 'book_today')
          const doneKey = isTomorrowFlow
            ? `codebooking:done:tomorrow:${tenant.id}:${patientTapId}`
            : (isFutureFlow
              ? `codebooking:done:future:${tenant.id}:${patientTapId}:${flow.data.doctorId}:${flow.data.date}`
              : `codebooking:done:${tenant.id}:${patientTapId}`)

          // Re-tap right after a successful code booking for this patient: fixed reply, no Gemini.
          // Checked before the flow, because the flow now stays alive after a success.
          let alreadyBooked = false
          try {
            const markerRedis = require('../../../config/redis')
            alreadyBooked = !!(await markerRedis.get(doneKey))
          } catch (markerErr) {
            logger.warn('code_booking_flow done-marker read failed, continuing:', markerErr.message)
          }
          if (alreadyBooked) {
            const alreadyText = 'This booking is already confirmed. Tap Check My Booking, or say Hi for the menu.'
            await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
            HITLService.broadcastToTenant(tenant.id, 'new_message', {
              conversationId: context.conversation.id,
              message: { role: 'user', content: message.message, created_at: new Date().toISOString() }
            })
            await sendMessage(message.from, alreadyText)
            await ConversationService.saveOutboundMessage(context.conversation.id, alreadyText, 'assistant')
            HITLService.broadcastToTenant(tenant.id, 'new_message', {
              conversationId: context.conversation.id,
              message: { role: 'assistant', content: alreadyText, created_at: new Date().toISOString() }
            })
            logger.info(`CODE_BOOKING_FLOW step=${bookStep} result=already_booked tenant=${tenant.id} conversation=${context.conversation.id}`)
            return
          }

          let fallbackReason = null
          if (!flow || flow.state !== 'choose_patient') fallbackReason = 'no_state'
          else if (flow.expired) fallbackReason = 'expired'
          else if (flow.data?.kind === 'tomorrow') {
            if (!flow.data?.doctorId) fallbackReason = 'missing_values'
          }
          else if (isFutureFlow) { /* kind 'future' with doctor, date and session: bookable */ }
          else if (flow.data?.kind !== 'today') fallbackReason = 'wrong_kind'
          else if (!flow.data?.doctorId || !flow.data?.sessionStart) fallbackReason = 'missing_values'

          // Tomorrow list tapped after the date moved on (for example after midnight IST): do not book
          if (!fallbackReason && isTomorrowFlow && flow.data.date) {
            const istNowTmr = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
            istNowTmr.setDate(istNowTmr.getDate() + 1)
            const istTomorrow = `${istNowTmr.getFullYear()}-${String(istNowTmr.getMonth() + 1).padStart(2, '0')}-${String(istNowTmr.getDate()).padStart(2, '0')}`
            if (flow.data.date !== istTomorrow) {
              await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
              HITLService.broadcastToTenant(tenant.id, 'new_message', {
                conversationId: context.conversation.id,
                message: { role: 'user', content: message.message, created_at: new Date().toISOString() }
              })
              const expiredText = 'This list has expired. Say Hi to start again.'
              await sendMessage(message.from, expiredText)
              await ConversationService.saveOutboundMessage(context.conversation.id, expiredText, 'assistant')
              HITLService.broadcastToTenant(tenant.id, 'new_message', {
                conversationId: context.conversation.id,
                message: { role: 'assistant', content: expiredText, created_at: new Date().toISOString() }
              })
              await clearFlow(tenant.id, message.from)
              logger.info(`CODE_BOOKING_FLOW step=book_tomorrow result=fallback reason=date_changed tenant=${tenant.id} conversation=${context.conversation.id}`)
              return
            }
          }

          // Future list tapped when its date is no longer within +1 to +6 days IST (same window create_future_booking uses): do not book
          if (!fallbackReason && isFutureFlow) {
            const istNowFut = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
            const istDateStrFut = (daysAhead) => {
              const d = new Date(istNowFut)
              d.setDate(d.getDate() + daysAhead)
              return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
            }
            if (flow.data.date < istDateStrFut(1) || flow.data.date > istDateStrFut(6)) {
              await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
              HITLService.broadcastToTenant(tenant.id, 'new_message', {
                conversationId: context.conversation.id,
                message: { role: 'user', content: message.message, created_at: new Date().toISOString() }
              })
              const expiredFutText = 'This list has expired. Say Hi to start again.'
              await sendMessage(message.from, expiredFutText)
              await ConversationService.saveOutboundMessage(context.conversation.id, expiredFutText, 'assistant')
              HITLService.broadcastToTenant(tenant.id, 'new_message', {
                conversationId: context.conversation.id,
                message: { role: 'assistant', content: expiredFutText, created_at: new Date().toISOString() }
              })
              await clearFlow(tenant.id, message.from)
              logger.info(`CODE_BOOKING_FLOW step=book_future result=fallback reason=date_changed tenant=${tenant.id} conversation=${context.conversation.id}`)
              return
            }
          }

          // Double-tap lock: one booking attempt per patient at a time
          const lockKey = `codebooking:lock:${tenant.id}:${patientTapId}`
          let lockHeld = false
          let lockRedis = null
          if (!fallbackReason) {
            try {
              lockRedis = require('../../../config/redis')
              lockHeld = (await lockRedis.set(lockKey, '1', { NX: true, EX: 30 })) === 'OK'
              if (!lockHeld) {
                logger.info(`CODE_BOOKING_FLOW step=${bookStep} result=duplicate_tap tenant=${tenant.id} conversation=${context.conversation.id}`)
                return
              }
            } catch (lockErr) {
              logger.warn('code_booking_flow lock failed, using AI path:', lockErr.message)
              fallbackReason = 'lock_error'
            }
          }

          if (fallbackReason) {
            logger.info(`CODE_BOOKING_FLOW step=${bookStep} result=fallback reason=${fallbackReason} tenant=${tenant.id} conversation=${context.conversation.id}`)
          } else {
            try {
              const bookingCtx = { tenant, customer: context.customer, conversation: context.conversation, latestMessage: message.message, interactiveId: message.interactiveId, doctorProfiles: [] }
              let outText = ''
              let outcome = 'business_reply'
              try {
                const bookingResult = isTomorrowFlow
                  ? await executeFunction(
                      'create_tomorrow_booking',
                      { doctor_id: flow.data.doctorId, patient_id: patientTapId },
                      bookingCtx
                    )
                  : isFutureFlow
                  ? await executeFunction(
                      'create_future_booking',
                      { doctor_id: flow.data.doctorId, patient_id: patientTapId, booking_date: flow.data.date, session_start_time: flow.data.sessionStart },
                      bookingCtx
                    )
                  : await executeFunction(
                      'create_token_booking',
                      { doctor_id: flow.data.doctorId, patient_id: patientTapId, session_start_time: flow.data.sessionStart },
                      bookingCtx
                    )
                if (typeof bookingResult === 'string' && bookingResult.startsWith('DIRECT:')) {
                  outText = bookingResult.slice(7).trim()
                  outcome = outText.includes('Booking confirmed') ? 'success' : 'business_reply'
                } else if (typeof bookingResult === 'string' && bookingResult.trim()) {
                  outText = bookingResult.trim()
                } else if (bookingResult && bookingResult.success === false && bookingResult.message) {
                  outText = String(bookingResult.message)
                } else {
                  outcome = 'error'
                }
              } catch (bookErr) {
                logger.error('Code-only booking failed: ' + bookErr?.message)
                outcome = 'error'
              }

              await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
              HITLService.broadcastToTenant(tenant.id, 'new_message', {
                conversationId: context.conversation.id,
                message: { role: 'user', content: message.message, created_at: new Date().toISOString() }
              })

              if (outcome === 'error') {
                // Never fall back to Gemini after the booking function ran: it could double-book
                outText = 'Sorry, I could not complete your booking. Please tap Book Appointment to try again, or tap Talk to Staff.'
              }
              await sendMessage(message.from, outText)
              await ConversationService.saveOutboundMessage(context.conversation.id, outText, 'assistant')
              HITLService.broadcastToTenant(tenant.id, 'new_message', {
                conversationId: context.conversation.id,
                message: { role: 'assistant', content: outText, created_at: new Date().toISOString() }
              })

              if (outcome === 'error') {
                try {
                  const welcome = await executeFunction('show_welcome', {}, { tenant, customer: context.customer, conversation: context.conversation, latestMessage: message.message, interactiveId: null, doctorProfiles: [] })
                  const welcomeContent = typeof welcome === 'string' && welcome.startsWith('DIRECT:') ? welcome.slice(7).trim() : ''
                  if (welcomeContent.startsWith('__INTERACTIVE_SENT__::')) {
                    await ConversationService.saveOutboundMessage(context.conversation.id, welcomeContent.slice('__INTERACTIVE_SENT__::'.length), 'assistant')
                  } else if (welcomeContent) {
                    await sendMessage(message.from, welcomeContent)
                    await ConversationService.saveOutboundMessage(context.conversation.id, welcomeContent, 'assistant')
                  }
                } catch (welcomeErr) {
                  logger.warn('Resending welcome after code booking error failed (non-fatal):', welcomeErr.message)
                }
              }

              // Same contact card as the AI path, once per conversation
              if (source === 'meta' && tenant.whatsapp_number && outText.includes('Booking confirmed')) {
                try {
                  const pool = require('../../../config/database')
                  const flagResult = await pool.query('SELECT contact_card_sent FROM conversations WHERE id = $1', [context.conversation.id])
                  if (flagResult.rows[0]?.contact_card_sent !== true) {
                    const { sendContact } = require('./whatsapp.meta')
                    await sendContact(message.from, tenant.name, tenant.whatsapp_number)
                    await pool.query('UPDATE conversations SET contact_card_sent = true WHERE id = $1', [context.conversation.id])
                  }
                } catch (cardErr) {
                  logger.error('Contact card send failed (non-fatal):', JSON.stringify(cardErr.response?.data || cardErr.message))
                }
              }

              // Marketing consent question, once per customer, after the confirmed booking (never delays or breaks the booking)
              if (source === 'meta' && outText.includes('Booking confirmed')) {
                Consent.askConsentOnce(tenant, context.customer?.id, message.from, tenant.name, context.conversation.id).catch(() => {})
              }

              if (outcome === 'success') {
                try {
                  await lockRedis.set(doneKey, '1', { EX: 120 })
                } catch (markerErr) {
                  logger.warn('code_booking_flow done-marker write failed (non-fatal):', markerErr.message)
                }
              }
              // After a success keep the flow so another patient from the same list books in code
              // (its own 30 minute expiresAt still applies); other outcomes clear it
              if (outcome !== 'success') await clearFlow(tenant.id, message.from)
              logger.info(`CODE_BOOKING_FLOW step=${bookStep} result=${outcome} tenant=${tenant.id} conversation=${context.conversation.id}`)
              return
            } finally {
              if (lockHeld) {
                try { await lockRedis.del(lockKey) } catch (unlockErr) { logger.warn('code_booking_flow lock release failed:', unlockErr.message) }
              }
            }
          }
        }
      }

      // Code flow: confirm / change buttons shown after a typed new-patient name (ids cannot match patient_<uuid>)
      if ((message.interactiveId === 'newname_yes' || message.interactiveId === 'newname_change') && await isCodeFlowOn()) {
        const tapFlow = await CodeFlow.getFlow(tenant.id, message.from)
        const tapLive = !!tapFlow && !tapFlow.expired && tapFlow.state === 'choose_patient' && tapFlow.step === 'confirm_new_name' &&
          ((tapFlow.data?.kind === 'today' && !!tapFlow.data.doctorId && !!tapFlow.data.sessionStart) ||
           (tapFlow.data?.kind === 'tomorrow' && !!tapFlow.data.doctorId && !!tapFlow.data.date))
        if (!tapLive || (message.interactiveId === 'newname_yes' && !tapFlow.data.pendingName)) {
          await saveNameInbound()
          await sendNameReply('This request has expired. Say Hi to start again.')
          logName('fallback', ` reason=${tapFlow && tapFlow.expired ? 'expired' : 'no_state'}`)
          return
        }
        if (message.interactiveId === 'newname_yes') {
          await runNameBooking(tapFlow.data, tapFlow.data.pendingName, 'low')
          return
        }
        await storeNameStep('await_new_name', tapFlow.data, 0, null)
        await saveNameInbound()
        await sendNameReply("Please reply with the patient's full name.")
        logName('change_name')
        return
      }

      // Intercept "Book for someone else" tap — ask for name
      if (message.interactiveId === 'patient_new') {
        // Code flow: remember that the next typed text is a name (today flow with known doctor and session only)
        if (await isCodeFlowOn()) {
          const listFlow = await CodeFlow.getFlow(tenant.id, message.from)
          if (listFlow && !listFlow.expired && listFlow.state === 'choose_patient' && listFlow.data?.kind === 'today' && listFlow.data.doctorId && listFlow.data.sessionStart) {
            await CodeFlow.setFlow(tenant.id, message.from, {
              state: 'choose_patient',
              step: 'await_new_name',
              kind: 'today',
              doctorId: listFlow.data.doctorId,
              doctorName: listFlow.data.doctorName,
              date: listFlow.data.date,
              sessionStart: listFlow.data.sessionStart,
              attempts: 0
            })
            logger.info(`CODE_BOOKING_FLOW step=await_new_name tenant=${tenant.id} conversation=${context.conversation.id} doctor=${listFlow.data.doctorId} date=${listFlow.data.date || null} session=${listFlow.data.sessionStart}`)
          } else if (listFlow && !listFlow.expired && listFlow.state === 'choose_patient' && listFlow.data?.kind === 'tomorrow' && listFlow.data.doctorId && listFlow.data.date) {
            // Tomorrow list: arm the name step with the flow's own kind and date
            await storeNameStep('await_new_name', listFlow.data, 0, null)
            logger.info(`CODE_BOOKING_FLOW step=await_new_name tenant=${tenant.id} conversation=${context.conversation.id} doctor=${listFlow.data.doctorId} date=${listFlow.data.date} session=null`)
          } else if (!listFlow || listFlow.expired) {
            // Dead list: do not ask for a name, because the typed answer would go to Gemini
            await saveNameInbound()
            await sendNameReply('This list has expired. Say Hi to start again.')
            logger.info(`CODE_BOOKING_FLOW step=await_new_name result=fallback reason=${listFlow ? 'expired' : 'no_state'} tenant=${tenant.id} conversation=${context.conversation.id}`)
            return
          }
        }
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
              // Code flow: no saved patients, so no list was sent; record the name step from the session button id
              const newPatientSession = message.interactiveId.match(/^session_([0-9a-f-]{36})_(\d{2})-(\d{2})-(\d{2})$/)
              if (newPatientSession && await isCodeFlowOn()) {
                const npSessionStart = `${newPatientSession[2]}:${newPatientSession[3]}:${newPatientSession[4]}`
                await CodeFlow.setFlow(tenant.id, message.from, {
                  state: 'choose_patient',
                  step: 'await_new_name',
                  kind: 'today',
                  doctorId: newPatientSession[1],
                  doctorName: null,
                  date: null,
                  sessionStart: npSessionStart,
                  attempts: 0
                })
                logger.info(`CODE_BOOKING_FLOW step=await_new_name tenant=${tenant.id} conversation=${context.conversation.id} doctor=${newPatientSession[1]} date=null session=${npSessionStart}`)
              }
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
          // Code flow: when the offered day has exactly one session for the stored doctor, pass them on so the flow knows the doctor and session
          let dayTapArgs = {}
          if (await isCodeFlowOn()) {
            try {
              const dayKeyRaw = await require('../../../config/redis').get(`anotherday_days:${context.conversation.id}`)
              const dayTapDate = message.interactiveId.split('::')[1]
              if (dayKeyRaw) {
                const dayKeyData = JSON.parse(dayKeyRaw)
                const daySessions = dayKeyData?.days?.[dayTapDate]
                if (dayKeyData?.doctor_id && Array.isArray(daySessions) && daySessions.length === 1) {
                  dayTapArgs = { doctor_id: dayKeyData.doctor_id, internal_kind: 'future', internal_date: dayTapDate, internal_session: daySessions[0] }
                }
              }
            } catch (dayKeyErr) {
              logger.warn('another-day day key read failed, using the normal day tap:', dayKeyErr.message)
              dayTapArgs = {}
            }
          }
          const result = await executeFunction('get_patient_profiles', dayTapArgs, { tenant, customer: context.customer, conversation: context.conversation, latestMessage: message.message, interactiveId: message.interactiveId, doctorProfiles: [] })
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

      // Code flow: Book Another Day doctor tap (a bare doctor uuid whose list row description says "this week").
      // Placed after the other interactive shortcuts; anything that does not match falls through to the AI path unchanged.
      if (message.interactiveId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(message.interactiveId) &&
          /this week/i.test(message.interactiveDescription || '') && await isCodeFlowOn()) {
        const logAnotherDay = (result) => logger.info(`CODE_BOOKING_FLOW step=another_day_doctor result=${result} tenant=${tenant.id} conversation=${context.conversation.id}`)
        await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
        let anotherDayResult = null
        let anotherDayFailed = false
        try {
          const { executeFunction } = require('../../ai-engine/ai.executor')
          anotherDayResult = await executeFunction('get_doctor_schedule', {}, { tenant, customer: context.customer, conversation: context.conversation, latestMessage: message.message, interactiveId: message.interactiveId, doctorProfiles: [] })
        } catch (anotherDayErr) {
          logger.error('Another Day doctor schedule failed: ' + anotherDayErr?.message)
          anotherDayFailed = true
        }
        if (!anotherDayFailed && typeof anotherDayResult === 'string' && anotherDayResult.startsWith('DIRECT:')) {
          const anotherDayContent = anotherDayResult.slice(7).trim()
          if (anotherDayContent.startsWith('__INTERACTIVE_SENT__::')) {
            await ConversationService.saveOutboundMessage(context.conversation.id, anotherDayContent.slice('__INTERACTIVE_SENT__::'.length), 'assistant')
            logAnotherDay('list_sent')
          } else {
            await sendMessage(message.from, anotherDayContent)
            await ConversationService.saveOutboundMessage(context.conversation.id, anotherDayContent, 'assistant')
            logAnotherDay('text_sent')
          }
          return
        }
        // The function ran but failed or returned something unexpected: never fall back to Gemini
        await sendNameReply('Sorry, something went wrong. Please try again.')
        await sendNameWelcome()
        logAnotherDay('error')
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
            // Code flow: a stored doctor leads to the tomorrow patient list instead of booking by names
            if (await isCodeFlowOn()) {
              let tomorrowKeyData = null
              try { tomorrowKeyData = JSON.parse(stored) } catch (parseErr) { tomorrowKeyData = null }
              if (tomorrowKeyData?.doctor_id) {
                const istNowList = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
                istNowList.setDate(istNowList.getDate() + 1)
                const tomorrowListDate = `${istNowList.getFullYear()}-${String(istNowList.getMonth() + 1).padStart(2, '0')}-${String(istNowList.getDate()).padStart(2, '0')}`
                await saveNameInbound()
                let listOutcome = 'error'
                try {
                  const listResult = await executeFunction(
                    'get_patient_profiles',
                    { doctor_id: tomorrowKeyData.doctor_id, internal_kind: 'tomorrow', internal_date: tomorrowListDate },
                    { tenant, customer: context.customer, conversation: context.conversation, latestMessage: message.message, interactiveId: null, doctorProfiles: [] }
                  )
                  const listContent = typeof listResult === 'string' && listResult.startsWith('DIRECT:') ? listResult.slice(7).trim() : ''
                  if (listContent.startsWith('__INTERACTIVE_SENT__::')) {
                    await ConversationService.saveOutboundMessage(context.conversation.id, listContent.slice('__INTERACTIVE_SENT__::'.length), 'assistant')
                    listOutcome = 'list_sent'
                  } else if (listContent.startsWith('NEW_PATIENT::')) {
                    // No saved patients: ask for the name and book tomorrow in code
                    await CodeFlow.setFlow(tenant.id, message.from, {
                      state: 'choose_patient',
                      step: 'await_new_name',
                      kind: 'tomorrow',
                      doctorId: tomorrowKeyData.doctor_id,
                      doctorName: null,
                      date: tomorrowListDate,
                      sessionStart: null,
                      attempts: 0
                    })
                    await sendNameReply("Please reply with the patient's full name.")
                    listOutcome = 'name_prompt'
                  }
                } catch (listErr) {
                  logger.error('Tomorrow patient list failed: ' + listErr?.message)
                }
                if (listOutcome === 'error') {
                  // Never fall back to Gemini here; a failed list send is treated as an error too
                  await CodeFlow.clearFlow(tenant.id, message.from)
                  await sendNameReply('Sorry, I could not complete your booking. Please tap Book Appointment to try again, or tap Talk to Staff.')
                  await sendNameWelcome()
                } else {
                  await redisClient.del(tomorrowKey)
                }
                logger.info(`CODE_BOOKING_FLOW step=tomorrow_list result=${listOutcome} tenant=${tenant.id} conversation=${context.conversation.id}`)
                return
              }
            }
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

      // Code-only typed new-patient name for the book-today and book-tomorrow flows (flag on, flow step await_new_name / confirm_new_name).
      // Anything that does not match falls through to the AI path unchanged.
      if (message.type === 'text' && !message.interactiveId && await isCodeFlowOn()) {
        const nameCheck = validatePatientName(message.message)
        const nameFlow = await CodeFlow.getFlow(tenant.id, message.from)

        if (!nameFlow) {
          if (nameCheck) logName('fallback', ' reason=no_state')
        } else if (nameFlow.state === 'choose_patient' && (nameFlow.step === 'await_new_name' || nameFlow.step === 'confirm_new_name') && (nameFlow.data?.kind === 'today' || nameFlow.data?.kind === 'tomorrow')) {
          if (nameFlow.expired) {
            logName('fallback', ' reason=expired')
          } else if (nameFlow.data.doctorId && (nameFlow.data.kind === 'tomorrow' ? nameFlow.data.date : nameFlow.data.sessionStart)) {
            const nameAttempts = nameFlow.data.attempts || 0

            if (!nameCheck) {
              // Not a usable name: one retry, then back to the menu
              const attemptsNow = nameAttempts + 1
              await saveNameInbound()
              if (attemptsNow < 2) {
                await storeNameStep(nameFlow.step, nameFlow.data, attemptsNow, nameFlow.data.pendingName)
                await sendNameReply("Sorry, I didn't catch a name. Please reply with the patient's full name.")
              } else {
                await CodeFlow.clearFlow(tenant.id, message.from)
                await sendNameWelcome()
              }
              logName('invalid_name', ` attempts=${attemptsNow}`)
              return
            }

            // Valid and confident name: book straight away (same helper as the Yes button)
            if (isConfidentName(nameCheck.typed)) {
              await runNameBooking(nameFlow.data, nameCheck.typed, 'high')
              return
            }
            // Valid but unsure name: ask the patient to confirm it before anything is booked
            await saveNameInbound()
            await sendNameConfirm(nameFlow.data, nameCheck, nameAttempts)
            return
          }
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
      let isBlockedConfirmation = false
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
        } else if (aiResponse?.blockedConfirmation) {
          isBlockedConfirmation = true
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
       logger.error(`AI processing crashed for [redacted]: ${err?.message} ${err?.stack}`)
        const clinicPhone = configs?.business_phone ? ` or call us at ${configs.business_phone}` : ''
        aiResponse = `Sorry, I could not process that. Please say Hi to try again${clinicPhone}.`
        isAIError = true
      }


let assistantRow = null
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
  assistantRow = await ConversationService.saveOutboundMessage(
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
  // Delivery tracking of the main assistant reply: the Meta message id on success, the error code on failure
  const { recordDelivery } = require('./whatsapp.meta')
  try {
    const aiSendResult = await sendMessage(message.from, aiResponse)
    recordDelivery(assistantRow?.id, aiSendResult, null)
  } catch (aiSendErr) {
    recordDelivery(assistantRow?.id, null, aiSendErr)
    throw aiSendErr
  }
}

// After a blocked fake confirmation, resend the welcome menu so the patient can start over
if (isBlockedConfirmation) {
  try {
    const welcome = await executeFunction('show_welcome', {}, { tenant, customer: context.customer, conversation: context.conversation, latestMessage: message.message, interactiveId: null, doctorProfiles: [] })
    const welcomeContent = typeof welcome === 'string' && welcome.startsWith('DIRECT:') ? welcome.slice(7).trim() : ''
    if (welcomeContent.startsWith('__INTERACTIVE_SENT__::')) {
      await ConversationService.saveOutboundMessage(context.conversation.id, welcomeContent.slice('__INTERACTIVE_SENT__::'.length), 'assistant')
    } else if (welcomeContent) {
      await sendMessage(message.from, welcomeContent)
      await ConversationService.saveOutboundMessage(context.conversation.id, welcomeContent, 'assistant')
    }
  } catch (welcomeErr) {
    logger.warn('Resending welcome after blocked confirmation failed (non-fatal):', welcomeErr.message)
  }
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
            await sendContact(message.from, tenant.name, tenant.whatsapp_number)
            await pool.query(
              'UPDATE conversations SET contact_card_sent = true WHERE id = $1',
              [context.conversation.id]
            )
          }
        } catch (err) {
          logger.error('Contact card send failed (non-fatal):', JSON.stringify(err.response?.data || err.message))
        }
      }

      // Marketing consent question, once per customer, after the confirmed booking (never delays or breaks the booking)
      if (source === 'meta' && isBookingConfirmation) {
        Consent.askConsentOnce(tenant, context.customer?.id, message.from, tenant.name, context.conversation.id).catch(() => {})
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
})

module.exports = router

const express = require('express')
const router = express.Router()
const { parseIncoming, sendMessage, sendButtons } = require('./whatsapp.adapter')
const { executeFunction } = require('../../ai-engine/ai.executor')
const { successResponse } = require('../../../utils/response')
const logger = require('../../../utils/logger')
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
  const isMetaPayload = req.body?.object === 'whatsapp_business_account';
  if (isMetaPayload && !appSecret && process.env.NODE_ENV === 'production') {
    logger.error('META_APP_SECRET not set — rejecting Meta webhook');
    return res.status(503).json({ success: false, error: 'Webhook not configured' });
  }
  if (appSecret && isMetaPayload) {
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
    const senderContext = require('./senderContext')
    const incomingPhoneId = req.body?.object === 'whatsapp_business_account'
      ? req.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id
      : null
    await senderContext.run(incomingPhoneId, async () => {
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
      const storeNameStep = (step, flowData, attempts, pendingName) => CodeFlow.setFlow(tenant.id, message.from, {
        state: 'choose_patient',
        step,
        kind: 'today',
        doctorId: flowData.doctorId,
        doctorName: flowData.doctorName,
        date: flowData.date,
        sessionStart: flowData.sessionStart,
        attempts,
        pendingName: pendingName || null
      })
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
            const nameResult = await executeFunction(
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

          // Re-tap right after a successful code booking for this patient: fixed reply, no Gemini.
          // Checked before the flow, because the flow now stays alive after a success.
          let alreadyBooked = false
          try {
            const markerRedis = require('../../../config/redis')
            alreadyBooked = !!(await markerRedis.get(`codebooking:done:${tenant.id}:${patientTapId}`))
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
            logger.info(`CODE_BOOKING_FLOW step=book_today result=already_booked tenant=${tenant.id} conversation=${context.conversation.id}`)
            return
          }

          const flow = await getFlow(tenant.id, message.from)
          let fallbackReason = null
          if (!flow || flow.state !== 'choose_patient') fallbackReason = 'no_state'
          else if (flow.expired) fallbackReason = 'expired'
          else if (flow.data?.kind !== 'today') fallbackReason = 'wrong_kind'
          else if (!flow.data?.doctorId || !flow.data?.sessionStart) fallbackReason = 'missing_values'

          // Double-tap lock: one booking attempt per patient at a time
          const lockKey = `codebooking:lock:${tenant.id}:${patientTapId}`
          let lockHeld = false
          let lockRedis = null
          if (!fallbackReason) {
            try {
              lockRedis = require('../../../config/redis')
              lockHeld = (await lockRedis.set(lockKey, '1', { NX: true, EX: 30 })) === 'OK'
              if (!lockHeld) {
                logger.info(`CODE_BOOKING_FLOW step=book_today result=duplicate_tap tenant=${tenant.id} conversation=${context.conversation.id}`)
                return
              }
            } catch (lockErr) {
              logger.warn('code_booking_flow lock failed, using AI path:', lockErr.message)
              fallbackReason = 'lock_error'
            }
          }

          if (fallbackReason) {
            logger.info(`CODE_BOOKING_FLOW step=book_today result=fallback reason=${fallbackReason} tenant=${tenant.id} conversation=${context.conversation.id}`)
          } else {
            try {
              const bookingCtx = { tenant, customer: context.customer, conversation: context.conversation, latestMessage: message.message, interactiveId: message.interactiveId, doctorProfiles: [] }
              let outText = ''
              let outcome = 'business_reply'
              try {
                const bookingResult = await executeFunction(
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

              if (outcome === 'success') {
                try {
                  await lockRedis.set(`codebooking:done:${tenant.id}:${patientTapId}`, '1', { EX: 120 })
                } catch (markerErr) {
                  logger.warn('code_booking_flow done-marker write failed (non-fatal):', markerErr.message)
                }
              }
              // After a success keep the flow so another patient from the same list books in code
              // (its own 30 minute expiresAt still applies); other outcomes clear it
              if (outcome !== 'success') await clearFlow(tenant.id, message.from)
              logger.info(`CODE_BOOKING_FLOW step=book_today result=${outcome} tenant=${tenant.id} conversation=${context.conversation.id}`)
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
          tapFlow.data?.kind === 'today' && !!tapFlow.data.doctorId && !!tapFlow.data.sessionStart
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

      // Code-only typed new-patient name for the book-today flow (flag on, flow step await_new_name).
      // Anything that does not match falls through to the AI path unchanged.
      if (message.type === 'text' && !message.interactiveId && await isCodeFlowOn()) {
        const nameCheck = validatePatientName(message.message)
        const nameFlow = await CodeFlow.getFlow(tenant.id, message.from)

        if (!nameFlow) {
          if (nameCheck) logName('fallback', ' reason=no_state')
        } else if (nameFlow.state === 'choose_patient' && (nameFlow.step === 'await_new_name' || nameFlow.step === 'confirm_new_name') && nameFlow.data?.kind === 'today') {
          if (nameFlow.expired) {
            logName('fallback', ' reason=expired')
          } else if (nameFlow.data.doctorId && nameFlow.data.sessionStart) {
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

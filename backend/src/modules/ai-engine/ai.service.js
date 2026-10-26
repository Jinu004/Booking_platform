const { GoogleGenerativeAI } = require('@google/generative-ai')
const { getSystemPrompt } = require('./ai.prompts')
const { getFunctionDefinitions, getUnansweredQuestionDeclaration } = require('./ai.functions')
const { buildClinicInfoBlock, cleanProfileValue } = require('./clinicInfo')
const { isAppointmentBookingOn } = require('../../utils/appointmentFlag')
const { executeFunction } = require('./ai.executor')
const logger = require('../../utils/logger')
const { maskPhone } = require('../../utils/phone')
const pool = require('../../config/database')
const redisClient = require('../../config/redis')
const crypto = require('crypto')
const senderContext = require('../channel/whatsapp/senderContext')
const { runAttemptsWithRetry, isSafeToRepeatTool, safeReplyAfterStateChange, createTurnDeadline, assertWithinTurnDeadline } = require('./ai.retry')

const client = new GoogleGenerativeAI(
  process.env.GEMINI_API_KEY || ''
)

const MODELS = {
  pro: 'gemini-2.5-pro',
  growth: 'gemini-2.5-flash',
  starter: 'gemini-2.5-flash'
}
const MODEL = 'gemini-2.5-flash' // default fallback

// One log line per Gemini response with its token usage. Never throws, so it cannot affect a reply.
function logGeminiUsage(tenant, conversation, modelName, geminiResult) {
  try {
    const usage = geminiResult?.usageMetadata
    logger.info(`GEMINI_USAGE tenant=${tenant?.id || 'unknown'} conv=${conversation?.id || 'none'} model=${modelName || 'unknown'} prompt=${usage?.promptTokenCount ?? 0} cached=${usage?.cachedContentTokenCount ?? 0} output=${usage?.candidatesTokenCount ?? 0} total=${usage?.totalTokenCount ?? 0}`)
  } catch (usageLogErr) {
    // ignore: usage logging is best effort
  }
}

// The clinic's own contact numbers (business phone, the guided-answers phone, the WhatsApp number), as their last 10 digits. The AI's
// reply may repeat these: every other phone number in a reply is still masked by the output filter. One query, kept 60 seconds per clinic
// in memory (a saved change can take up to a minute to show).
const OWN_NUMBERS_TTL_MS = 60 * 1000
const ownNumbersCache = new Map()
let ownNumbersWarnedAt = 0

const last10Digits = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : null
}

async function getClinicOwnNumbers(tenantId) {
  const cached = ownNumbersCache.get(tenantId)
  if (cached && Date.now() - cached.at < OWN_NUMBERS_TTL_MS) return cached.numbers
  const res = await pool.query(
    `SELECT t.whatsapp_number, s.business_phone, s.ai_faq->>'clinic_phone' AS faq_phone
     FROM tenants t LEFT JOIN tenant_settings s ON s.tenant_id = t.id
     WHERE t.id = $1`,
    [tenantId]
  )
  const row = res.rows[0] || {}
  const numbers = new Set([row.business_phone, row.faq_phone, row.whatsapp_number].map(last10Digits).filter(Boolean))
  if (ownNumbersCache.size > 500) ownNumbersCache.clear()
  ownNumbersCache.set(tenantId, { at: Date.now(), numbers })
  return numbers
}

// Masks every Indian mobile number in a reply except the clinic's own (ownNumbers: a Set of last-10-digit strings)
function maskOtherNumbers(text, ownNumbers) {
  return text.replace(/\b(\+91[\s-]?)?[6-9]\d{9}\b/g, (match) => (ownNumbers.has(last10Digits(match)) ? match : '[number]'))
}

const HISTORY_ERROR_PHRASES = ['having trouble', 'could not process', 'try again'];

/**
 * Picks the messages the model sees as earlier conversation (the newest message is not part of it: the caller sends it fresh).
 * `messages` is the already sliced history, oldest first. `hasBlock` is true with the CLINIC INFORMATION block;
 * `infoChangedMs` is the time the clinic last changed its information (NaN when there is no block or no valid time).
 * When an assistant reply is dropped for the block-only reasons (offers/discounts words, older than the information change),
 * the run of patient messages waiting for it is dropped too, so the model never sees questions without an answer.
 */
function selectHistoryMessages(messages, hasBlock, infoChangedMs) {
  const dropped = new Set();
  messages.forEach((msg, i) => {
    if (msg.role !== 'assistant') return;
    const blockOnly =
      (hasBlock && /\b(offers?|discounts?)\b/i.test(msg.content || '')) ||
      (Number.isFinite(infoChangedMs) && new Date(msg.created_at).getTime() < infoChangedMs);
    if (!blockOnly) return;
    dropped.add(i);
    for (let j = i - 1; j >= 0 && messages[j].role === 'user'; j--) dropped.add(j);
  });
  return messages.filter((msg, i) => {
    if (dropped.has(i)) return false;
    if (msg.role === 'staff') return false;
    if (msg.role === 'assistant') {
      const content = msg.content?.toLowerCase() || '';
      if (HISTORY_ERROR_PHRASES.some(phrase => content.includes(phrase))) return false;
      // Output-filter artefacts ("[number]", "[ref]") in an earlier reply make the model copy them
      if (msg.content && (msg.content.includes('[number]') || msg.content.includes('[ref]'))) return false;
    }
    return true;
  });
}

// An 8-character fingerprint of the final system prompt for the REPLY_TIMING log line. The current date/time line and the "Doctors on
// duty today" line are removed first, so the same prompt gives the same hash from one minute to the next. The prompt text itself is
// never logged.
function hashPrompt(systemPrompt, plan, guided) {
  const stable = String(systemPrompt || '')
    .replace(/^CURRENT DATE & TIME \(IST\):.*$/m, '')
    .replace(/^Doctors on duty today:.*$/m, '')
  // The plan and the guided switch are part of the fingerprint, so a change of either always shows as a different hash
  return crypto.createHash('sha256').update(`${stable}\n#plan=${plan || ''}\n#guided=${guided ? 'on' : 'off'}`).digest('hex').slice(0, 8)
}

// The reply when the AI fails. The clinic's saved Business Phone is named only when it is cleaned by cleanProfileValue and still looks like
// a phone number (at least 6 digits); otherwise the text sends the patient to "the clinic" with no number. Both texts keep the words
// "try again", so the history filter (HISTORY_ERROR_PHRASES) still skips them.
function buildHiccupText(businessPhone) {
  const phone = cleanProfileValue(businessPhone, 20)
  const digits = phone.replace(/\D/g, '').length
  if (phone && digits >= 6) {
    return `We're having a brief hiccup on our end 😊 Please try again in a minute, or call us directly at ${phone} and our team will help you right away.`
  }
  return "We're having a brief hiccup on our end 😊 Please try again in a minute, or call the clinic and our team will help you right away."
}

// Gemini requires the history to start with a user entry ("First content should be with role 'user'" otherwise). The history is cut
// to start at its first user entry; with no user entry at all it is empty.
function startHistoryWithUser(history) {
  const firstUserIndex = history.findIndex(m => m.role === 'user');
  if (firstUserIndex === -1) return [];
  return firstUserIndex > 0 ? history.slice(firstUserIndex) : history;
}

/**
 * Processes an incoming message through Gemini
 * Handles multi-turn function calling loop
 *
 * @param {object} context
 * @param {object} context.tenant
 * @param {object} context.customer
 * @param {object} context.conversation
 * @param {Array}  context.recentMessages
 * @param {object} context.session
 * @param {object} context.configs
 * @param {object} context.additionalData
 * @returns {Promise<string>} AI response text
 */
async function processMessage(context) {
  const {
    tenant,
    customer,
    conversation,
    recentMessages,
    configs = {},
    additionalData = {},
    interactiveId
  } = context

  // The overall limit of this turn (90 s from here), per call of processMessage so turns never share it
  const turnDeadline = createTurnDeadline()

  try {
    if (!process.env.GEMINI_API_KEY) {
      logger.warn('GEMINI_API_KEY not set — AI features disabled')
      return 'Our AI assistant is currently being set up. Please call the clinic directly for assistance.'
    }

    // Inject doctor profiles for Pro plan clinics
    if (tenant.plan === 'pro' && tenant.industry === 'clinic') {
      try {
        const profilesCacheKey = `doctor_profiles:${tenant.id}`
        const cachedProfiles = await redisClient.get(profilesCacheKey)
        if (cachedProfiles) {
          additionalData.doctorProfiles = JSON.parse(cachedProfiles)
        } else {
          const profilesResult = await pool.query(
            `SELECT id, name, specialization, profile_description FROM clinic_doctors WHERE tenant_id = $1 AND is_active = true AND profile_description IS NOT NULL AND profile_description != ''`,
            [tenant.id]
          )
          additionalData.doctorProfiles = profilesResult.rows
          await redisClient.set(profilesCacheKey, JSON.stringify(profilesResult.rows), { EX: 60 })
        }
      } catch (err) {
        logger.warn('Failed to fetch doctor profiles for prompt:', err.message)
      }
    }

    // Inject doctor schedules for Pro plan clinics
    if (tenant.plan === 'pro' && tenant.industry === 'clinic') {
      try {
        const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
        const todayDow = nowIST.getDay()
        const schedCacheKey = `doctor_schedules:${tenant.id}:${todayDow}`
        let schedData = null
        try {
          const cached = await redisClient.get(schedCacheKey)
          if (cached) schedData = JSON.parse(cached)
        } catch (err) {
          logger.warn('Redis get failed for doctor schedules:', err.message)
        }
        if (!schedData) {
          const schedResult = await pool.query(
            `SELECT d.name, d.specialization, ds.day_of_week, ds.start_time, ds.end_time, ds.is_available
             FROM clinic_doctors d
             LEFT JOIN doctor_schedules ds ON d.id = ds.doctor_id
             WHERE d.tenant_id = $1 AND d.is_active = true
             ORDER BY d.name, ds.day_of_week`,
            [tenant.id]
          )
          const onDutyResult = await pool.query(
            `SELECT DISTINCT d.name FROM clinic_doctors d
             JOIN doctor_schedules ds ON d.id = ds.doctor_id
             WHERE d.tenant_id = $1
               AND d.is_active = true
               AND ds.day_of_week = $2
               AND ds.is_available = true
               AND d.leave_days = 0`,
            [tenant.id, todayDow]
          )
          schedData = {
            doctorSchedules: schedResult.rows,
            onDutyDoctors: onDutyResult.rows.map(r => r.name)
          }
          try {
            await redisClient.setEx(schedCacheKey, 60, JSON.stringify(schedData))
          } catch (err) {
            logger.warn('Redis set failed for doctor schedules:', err.message)
          }
        }
        additionalData.doctorSchedules = schedData.doctorSchedules
        additionalData.onDutyDoctors = schedData.onDutyDoctors
      } catch (err) {
        logger.warn('Failed to fetch doctor schedules for prompt:', err.message)
      }
    }

    // Inject knowledge base for Growth and Pro plan clinics
    if ((tenant.plan === 'growth' || tenant.plan === 'pro') && (tenant.industry === 'clinic' || tenant.industry === 'enquiry')) {
      try {
        const kbCacheKey = `tenant_settings:${tenant.id}`
        let kbData = null
        try {
          const cached = await redisClient.get(kbCacheKey)
          if (cached) kbData = JSON.parse(cached)
        } catch (err) {
          logger.warn('Redis get failed for knowledge base:', err.message)
        }
        if (!kbData) {
          const kbResult = await pool.query(
            'SELECT ai_knowledge_base, business_address, business_phone, business_email, payment_upi, payment_phone FROM tenant_settings WHERE tenant_id = $1',
            [tenant.id]
          )
          kbData = kbResult.rows[0] || {}
          try {
            await redisClient.setEx(kbCacheKey, 60, JSON.stringify(kbData))
          } catch (err) {
            logger.warn('Redis set failed for knowledge base:', err.message)
          }
        }
        const kb = kbData.ai_knowledge_base
        if (kb && kb.trim()) {
          additionalData.knowledgeBase = kb.trim()
        }
        additionalData.businessAddress = kbData.business_address || ''
        additionalData.businessPhone = kbData.business_phone || ''
        additionalData.businessEmail = kbData.business_email || ''
        additionalData.paymentUpi = kbData.payment_upi || ''
        additionalData.paymentPhone = kbData.payment_phone || ''
      } catch (err) {
        logger.warn('Failed to fetch knowledge base for prompt:', err.message)
      }
    }

    // Guided clinic information: '' unless the clinic has ai_guided_kb on, the growth or pro plan and the clinic industry.
    // With '' nothing below changes: the prompts print exactly what they always did and the tool list is the same.
    additionalData.clinicInfoBlock = await buildClinicInfoBlock(tenant.id, { plan: tenant.plan, industry: tenant.industry })

    const systemPrompt = getSystemPrompt(tenant, configs, additionalData)
    // Appointment-by-time clinics (both switches on) get a different tool set; every other clinic gets exactly the list it always had
    const baseFunctionDeclarations = getFunctionDefinitions(tenant.industry, { appointmentBooking: isAppointmentBookingOn(configs) })
    // The unanswered-question tool is added only while the CLINIC INFORMATION block is in the prompt
    const functionDeclarations = additionalData.clinicInfoBlock
      ? [...baseFunctionDeclarations, getUnansweredQuestionDeclaration()]
      : baseFunctionDeclarations

    const FALLBACK_MODEL = 'gemini-2.5-flash-lite';
    const MAX_ATTEMPTS = 3;
    // True once a tool (function) has been executed in this turn. A retry restarts the whole turn from the patient's message,
    // so after a tool has run, a timeout is not retried (the tool could repeat, e.g. a booking).
    let toolHasRun = false;
    const isTransientError = (err) => {
      const msg = err.message || '';
      // A timeout / abort of the Gemini request is retried (with the fallback model) only before any tool has run
      if (!toolHasRun && (err.name === 'AbortError' || /aborted|timed out|timeout/i.test(msg))) return true;
      return (
        msg.includes('503') ||
        msg.includes('Service Unavailable') ||
        msg.includes('429') ||
        msg.includes('Too Many Requests') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('timeout') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT')
      );
    };

    // The first tool of this turn that is NOT read-only or safe to repeat (null = none). Per turn, declared here inside processMessage,
    // so it is never shared between turns. After such a tool no error restarts the turn (see ai.retry.js).
    let stateChangingTool = null;
    const promptHash = hashPrompt(systemPrompt, tenant.plan, !!additionalData.clinicInfoBlock);

    return await runAttemptsWithRetry({
      maxAttempts: MAX_ATTEMPTS,
      tenantId: tenant.id,
      logger,
      isTransient: isTransientError,
      getTurnState: () => ({ toolHasRun, stateChangingTool }),
      // A state-changing tool already ran: the patient gets a safe reply (sent and saved like any AI reply, and staff are alerted as for a failed turn)
      onStateChangingStop: () => ({ error: true, text: safeReplyAfterStateChange(tenant.industry) }),
      // The turn used up its 90 s before a new attempt or a tool round: the failure text (enquiry clinics: the same text without a phone)
      deadline: turnDeadline,
      onDeadline: () => ({ error: true, text: buildHiccupText(tenant.industry === 'enquiry' ? null : additionalData.businessPhone) }),
      runAttempt: async (attempt) => {
        const currentModel = attempt === 1 ? MODEL : FALLBACK_MODEL;
        if (attempt > 1) {
          logger.warn(`Gemini falling back to ${FALLBACK_MODEL} on attempt ${attempt}`);
        }
        // For the REPLY_TIMING log line: prompt hash, plan, guided switch and the model of this attempt (the last attempt wins)
        senderContext.setAiTrace({ ph: promptHash, plan: tenant.plan, guided: !!additionalData.clinicInfoBlock, model: currentModel });

        // Initialize Gemini model with tools
        const model = client.getGenerativeModel({
          model: currentModel,
          systemInstruction: systemPrompt,
          tools: [{ functionDeclarations }],
          generationConfig: {
            thinkingConfig: {
              thinkingBudget: 0
            }
          }
        })

        // Build conversation history for Gemini
        // Gemini uses 'model' not 'assistant' for AI role
        // Skip the last message — it will be sent fresh
        // With the CLINIC INFORMATION block, the AI's own replies from before the clinic last changed its information are not shown
        // to the model (NaN, so nothing is skipped, when there is no block or no valid timestamp)
        const infoChangedMs = additionalData.clinicInfoBlock ? Date.parse(configs.ai_info_changed_at || '') : NaN;

        // slice(-21, -1) leaves out the newest message (the one being answered now), so it can never be dropped here
        const history = selectHistoryMessages((recentMessages || []).slice(-21, -1), !!additionalData.clinicInfoBlock, infoChangedMs)
          .map(msg => ({
            role: msg.role === 'assistant' || msg.role === 'staff' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          }))

        const cleanHistory = startHistoryWithUser(history);

        // Get the latest message text to send
        const latestMessage = recentMessages?.[recentMessages.length - 1]?.content || ''

        // Reject oversized messages to prevent prompt injection and wasted tokens
        if (latestMessage.length > 1000) {
          return 'Your message is too long. Please send a shorter message.'
        }

        // Basic prompt injection filter
        const injectionPatterns = [
          /ignore (all |previous |prior )?instructions/i,
          /you are now/i,
          /forget (all |your )?instructions/i,
          /\[SYSTEM\]/i,
          /new instructions:/i,
          /pretend you are/i,
          /act as (a |an )?different/i,
        ];
        if (injectionPatterns.some(pattern => pattern.test(latestMessage))) {
          logger.warn(`Possible prompt injection attempt: ${latestMessage.slice(0, 100)}`);
          return 'I can only help with clinic appointments and bookings 😊 Please say Hi to start again.';
        }

        // Start chat session with conversation history
        const chat = model.startChat({ history: cleanHistory })

        // Send the latest patient message
        // 25 s on the first attempt, 20 s on a retry (keeps the patient's worst-case wait down)
        let response = await chat.sendMessage(latestMessage, { signal: AbortSignal.timeout(attempt === 1 ? 25000 : 20000) })
        let result = response.response
        logGeminiUsage(tenant, conversation, currentModel, result)

        // Function calling loop — Gemini may call multiple functions
        const maxIterations = 5
        let iteration = 0
        let escalated = false;
        const escalationMessage = 'I am connecting you with a staff member who can better assist you. Please wait a moment.';
        let patientBookingsCalled = false;

        while (iteration < maxIterations) {
          iteration++

          const candidate = result.candidates?.[0]
          if (!candidate) break

          // Collect any function calls in this response
          const functionCallParts = (candidate.content?.parts || [])
            .filter(part => part.functionCall)

          // No more function calls — final text response
          if (!functionCallParts.length) break

          // A tool round starts only while the turn still has time (otherwise the turn ends with the deadline reply)
          assertWithinTurnDeadline(turnDeadline)

          // Execute each function call sequentially
          const functionResponses = []
          const executedFunctions = new Set()

          for (const part of functionCallParts) {
            const { name, args } = part.functionCall
            // patient_id / doctor_id are internal-only; never accept them from Gemini
            if (args) {
              delete args.patient_id
              delete args.doctor_id
              delete args.internal_kind
              delete args.internal_date
              delete args.internal_session
            }

            if (executedFunctions.has(name)) {
              continue;
            }
            executedFunctions.add(name);

            logger.info(`Gemini calling function: ${name}`, JSON.stringify(args))

            toolHasRun = true
            if (!stateChangingTool && !isSafeToRepeatTool(name)) stateChangingTool = name
            const functionResult = await executeFunction(
              name,
              args,
              { tenant, customer, conversation, latestMessage, interactiveId, doctorProfiles: additionalData.doctorProfiles || [] }
            )

            if (name === 'get_patient_bookings') patientBookingsCalled = true

            // Handle direct-return signal — bypass Gemini rewrite
            if (typeof functionResult === 'string' && functionResult.startsWith('DIRECT:')) {
              const directContent = functionResult.slice(7).trim()
              // Interactive list sentinel — return structured object so webhook can skip sendMessage
              if (directContent.startsWith('__INTERACTIVE_SENT__::')) {
                return {
                  interactiveSent: true,
                  text: directContent.slice('__INTERACTIVE_SENT__::'.length)
                }
              }
              // New patient signal — return text to Gemini as function result so it asks for name
              if (directContent.startsWith('NEW_PATIENT::')) {
                functionResponses.push({
                  functionResponse: {
                    name,
                    response: { result: 'No existing profiles found. Please ask the patient for their name.' }
                  }
                })
                continue
              }
              return directContent
            }

            // Handle escalation signal
            if (
              typeof functionResult === 'string' &&
              functionResult.startsWith('ESCALATE:')
            ) {
              escalated = true;
              break;
            }

            functionResponses.push({
              functionResponse: {
                name,
                response: { result: functionResult }
              }
            })
          }
          
          if (escalated) break;

          // Feed function results back to Gemini
          // Same style of timeout as the first call (20 s here): an abort is a "timeout" error and goes through the existing retry loop
          response = await chat.sendMessage(functionResponses, { signal: AbortSignal.timeout(20000) })
          result = response.response
          logGeminiUsage(tenant, conversation, currentModel, result)
        }

        if (escalated) {
          return { escalated: true, text: escalationMessage };
        }

        // Extract final text response from Gemini
        let text;
        try {
          text = result.text()
        } catch (textErr) {
          return { error: true, text: 'Sorry, I didn\'t quite catch that! Please say Hi to start again 😊' };
        }
        if (!text || !text.trim()) {
          throw new Error('Empty text response from Gemini');
        }

        // Guard: a real booking confirmation is always returned as a DIRECT: result above (it exits the loop),
        // so a confirmation-looking reply written by Gemini here was never backed by a booking.
        if (/booking confirmed/i.test(text) && /token number/i.test(text) && !patientBookingsCalled) {
          logger.warn(`AI_FAKE_CONFIRMATION_BLOCKED tenant=${tenant.id} conversation=${conversation?.id} phone=${maskPhone(customer?.phone)}`)
          return { blockedConfirmation: true, text: 'Sorry, I could not complete your booking. Please tap Book Appointment to try again, or tap Talk to Staff.' }
        }

        // Output filter — strip any leaked UUIDs or phone numbers before sending to patient
        let cleanText = text.trim();
        cleanText = cleanText.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[ref]');
        // The clinic's own numbers stay visible; if they cannot be read, every number is masked as before
        let ownNumbers = new Set();
        try {
          if (tenant && tenant.id) ownNumbers = await getClinicOwnNumbers(tenant.id);
        } catch (ownErr) {
          if (Date.now() - ownNumbersWarnedAt >= 60 * 1000) {
            ownNumbersWarnedAt = Date.now();
            logger.warn(`AI_OWN_NUMBERS_FAILED tenant=${tenant && tenant.id} ${String(ownErr && ownErr.message).slice(0, 100)}`);
          }
        }
        cleanText = maskOtherNumbers(cleanText, ownNumbers);
        return cleanText;
      }
    });

  } catch (err) {
    logger.error('Gemini AI error: ' + JSON.stringify(err) + ' ' + err.stack)

    if (err.message?.includes('API_KEY') || err.message?.includes('API key')) {
      logger.warn('GEMINI_API_KEY invalid or missing')
      return { error: true, text: 'Our AI assistant is currently unavailable. Please contact the clinic directly.' }
    }

    return { error: true, text: buildHiccupText(additionalData.businessPhone) }
  }
}

module.exports = { processMessage, maskOtherNumbers, getClinicOwnNumbers, selectHistoryMessages, startHistoryWithUser, buildHiccupText, hashPrompt }

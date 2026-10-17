const pool = require('../../config/database')
const logger = require('../../utils/logger')
const { sendButtons, sendMessage } = require('../channel/whatsapp/whatsapp.adapter')

// Marketing consent per customer (one phone number at one clinic): customers.marketing_consent
// NULL = never asked, 'all' = checkups and offers, 'checkups' = checkup reminders only, 'none' = neither.
// Messages about appointments the patient books are not affected by consent.

const VALID_VALUES = ['all', 'checkups', 'none']

// Button ids of the consent message (titles are 20 characters or less)
const CONSENT_BUTTONS = [
  { id: 'consent_all', title: 'Checkups + offers' },
  { id: 'consent_checkups', title: 'Checkups only' },
  { id: 'consent_none', title: 'No thanks' }
]

const BUTTON_VALUES = {
  consent_all: 'all',
  consent_checkups: 'checkups',
  consent_none: 'none'
}

// STOP / SUBSCRIBE keywords: the whole trimmed, lower-cased message must match exactly
const STOP_KEYWORDS = new Set(['stop', 'unsubscribe', 'opt out', 'optout', 'stop offers'])
const SUBSCRIBE_KEYWORDS = new Set(['subscribe'])

function askBody(clinicName) {
  return `Thanks for booking with ${clinicName}! We'll message you about your appointments. Would you also like occasional updates from us?\n\nCheckups: a reminder when a visit is due.\nOffers: health tips and clinic news.\n\nReply STOP any time to opt out.`
}

const REPLIES = {
  all: "Thank you! We'll send checkup reminders and occasional offers. Reply STOP any time to stop.",
  checkups: "Thank you! We'll send checkup reminders only. Reply STOP any time to stop.",
  none: "No problem. We won't send checkup reminders or offers. You'll still get messages about appointments you book.",
  subscribe: "You're subscribed to checkup reminders and offers. Reply STOP any time to stop."
}

function stopReply(clinicName) {
  return `You won't receive checkup reminders or offers from ${clinicName} any more. You'll still get messages about appointments you book. Reply SUBSCRIBE to turn them back on.`
}

// 'none' for STOP-style keywords, 'all' for SUBSCRIBE, null for anything else (exact matches only)
function keywordValue(text) {
  const normalised = String(text || '').trim().toLowerCase()
  if (STOP_KEYWORDS.has(normalised)) return 'none'
  if (SUBSCRIBE_KEYWORDS.has(normalised)) return 'all'
  return null
}

// Value for a consent button id, or null for an unknown consent_ id
function buttonValue(interactiveId) {
  return Object.prototype.hasOwnProperty.call(BUTTON_VALUES, interactiveId) ? BUTTON_VALUES[interactiveId] : null
}

async function setConsent(tenantId, phone, value, source) {
  if (!VALID_VALUES.includes(value)) throw new Error('Invalid consent value')
  await pool.query(
    `UPDATE customers SET marketing_consent = $3, consent_at = NOW(), consent_source = $4
     WHERE tenant_id = $1 AND phone = $2`,
    [tenantId, phone, value, source]
  )
}

// Records the patient's own message and our plain-text reply, in the conversation and on the dashboard
async function saveAndSend(tenant, context, message, replyText) {
  const ConversationService = require('../conversation/conversation.service')
  const { broadcastToTenant } = require('../hitl/sse')
  await ConversationService.saveInboundMessage(context.conversation.id, message.message, message.type || 'text')
  broadcastToTenant(tenant.id, 'new_message', {
    conversationId: context.conversation.id,
    message: { role: 'user', content: message.message, created_at: new Date().toISOString() }
  })
  await sendMessage(message.from, replyText)
  await ConversationService.saveOutboundMessage(context.conversation.id, replyText, 'assistant')
  broadcastToTenant(tenant.id, 'new_message', {
    conversationId: context.conversation.id,
    message: { role: 'assistant', content: replyText, created_at: new Date().toISOString() }
  })
}

/**
 * Handles a consent choice made with a STOP / SUBSCRIBE keyword or a consent button: stores it and sends the matching reply.
 * @param {{ tenant, context, message, value: 'all'|'checkups'|'none', source: string, kind?: 'stop'|'subscribe' }} args
 */
async function handleChoice({ tenant, context, message, value, source, kind }) {
  await setConsent(tenant.id, message.from, value, source)
  let reply
  if (kind === 'stop') reply = stopReply(tenant.name)
  else if (kind === 'subscribe') reply = REPLIES.subscribe
  else reply = REPLIES[value]
  await saveAndSend(tenant, context, message, reply)
}

/**
 * Asks for marketing consent once per customer, right after a confirmed booking. Never throws.
 * The atomic claim means two parallel confirmations cannot both send it, and a customer who already
 * has an answer (or was already asked) is skipped.
 */
async function askConsentOnce(tenant, customerId, phone, clinicName, conversationId) {
  try {
    if (!tenant?.id || !customerId || !phone) return
    const claim = await pool.query(
      `UPDATE customers SET consent_asked_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND consent_asked_at IS NULL AND marketing_consent IS NULL
       RETURNING id`,
      [customerId, tenant.id]
    )
    if (!claim.rows.length) return

    const body = askBody(clinicName)
    await sendButtons(phone, body, CONSENT_BUTTONS)
    if (conversationId) {
      const ConversationService = require('../conversation/conversation.service')
      await ConversationService.saveOutboundMessage(conversationId, body, 'assistant')
    }
  } catch (err) {
    try { logger.warn(`CONSENT_ASK_FAILED ${String(err?.message || 'error').slice(0, 120)}`) } catch {}
  }
}

module.exports = {
  CONSENT_BUTTONS,
  VALID_VALUES,
  keywordValue,
  buttonValue,
  setConsent,
  handleChoice,
  askConsentOnce
}

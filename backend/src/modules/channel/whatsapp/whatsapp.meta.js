const axios = require('axios')
const logger = require('../../../utils/logger')
const pool = require('../../../config/database')
const senderContext = require('./senderContext')
const { maskPhone } = require('../../../utils/phone')

const META_TOKEN = process.env.META_WHATSAPP_TOKEN || ''
const META_API_URL = 'https://graph.facebook.com/v24.0'
// Timeout for the media upload and the template send, so a hung Meta call cannot freeze the campaign sender or a request
const META_CALL_TIMEOUT_MS = 20000

// Every send needs a tenant sender context with that clinic's own phone number id; there is no platform-wide fallback number.
// The context only holds the phone number id and token, so the tenant id is not available here.
const getPhoneId = () => {
  if (!senderContext.hasContext()) {
    logger.warn('TENANT_NO_NUMBER tenant=unknown result=blocked (no sender context)')
    throw new Error('No WhatsApp sender context - message not sent')
  }
  const id = senderContext.getPhoneNumberId()
  if (!id) {
    logger.warn('TENANT_NO_NUMBER tenant=unknown result=blocked')
    throw new Error('No WhatsApp Phone Number ID set for this clinic - message not sent')
  }
  return id
}

// The clinic's own Meta token when the sender context has one. The shared platform token (META_WHATSAPP_TOKEN) is used ONLY for a
// clinic a super admin flagged with tenant_configs platform_token_allowed = 'true'. Every other send, and a send with no tenant
// context, fails with NO_TENANT_TOKEN: the callers record it like any other send failure (send_failures) and never retry it in a loop.
// This is called inside the try of each send function, so the failure is recorded by recordSendFailure below.
const getToken = () => {
  const inContext = senderContext.hasContext()
  let reason = 'no_context'
  if (inContext) {
    const tenantToken = senderContext.getAccessToken()
    if (tenantToken) return tenantToken
    if (senderContext.getPlatformTokenAllowed()) {
      // A flagged clinic may use the platform token, but an empty one would only be rejected by Meta: block it with a clear reason
      if (String(META_TOKEN).trim()) return META_TOKEN
      reason = 'platform_token_missing'
    } else {
      reason = senderContext.getTokenState()
    }
  }
  const tenantId = inContext ? senderContext.getTenantId() : null
  const quiet = !blockedNoiseAllowed(tenantId)
  if (!quiet) logger.warn(`NO_TENANT_TOKEN tenant=${tenantId || 'unknown'} reason=${reason} result=blocked`)
  const err = new Error('No WhatsApp token for this clinic - message not sent')
  err.name = 'NO_TENANT_TOKEN'
  err.code = 'NO_TENANT_TOKEN'
  err.quiet = quiet // recordSendFailure skips the log line and the send_failures row for a repeat within the minute
  throw err
}

// The send still fails every time, but the log lines and the send_failures row for a blocked clinic are written at most once per
// minute per clinic (an in-memory map; old entries are dropped when it grows, so it cannot grow without bound)
const BLOCKED_NOISE_MS = 60 * 1000
const blockedNoise = new Map()
function blockedNoiseAllowed(tenantId) {
  const key = tenantId || 'unknown'
  const now = Date.now()
  const last = blockedNoise.get(key)
  if (last && now - last < BLOCKED_NOISE_MS) return false
  if (blockedNoise.size > 300) {
    for (const [k, t] of blockedNoise) if (now - t >= BLOCKED_NOISE_MS) blockedNoise.delete(k)
  }
  blockedNoise.set(key, now)
  return true
}

// Safe summary of a failed send: HTTP status, Meta error code/subcode, a trimmed message and the fbtrace id.
// Never the Authorization header, request body, phone numbers, tokens or message text.
function summariseSendError(err) {
  const metaError = err?.response?.data?.error
  const message = String(metaError?.message || err?.message || 'unknown error')
    .replace(/\s+/g, ' ')
    .replace(/EA[A-Za-z0-9]{20,}/g, '[token]')
    .replace(/\+?\d{7,}/g, '[number]')
    .slice(0, 200)
  const asInt = (value) => (Number.isInteger(Number(value)) && value !== null && value !== undefined && value !== '' ? Number(value) : null)
  return {
    http: asInt(err?.response?.status),
    code: asInt(metaError?.code),
    subcode: asInt(metaError?.error_subcode),
    message,
    trace: metaError?.fbtrace_id ? String(metaError.fbtrace_id).slice(0, 40) : null
  }
}

// Logs one line for a failed send (part of the message text, so it is always printed) and records a send_failures row.
// Never throws and never waits for the database, so it cannot break or delay a send.
function recordSendFailure(ctx, templateName, err) {
  // A repeat of "this clinic has no WhatsApp token" within the minute: already logged and recorded, nothing more is written
  if (err && err.code === 'NO_TENANT_TOKEN' && err.quiet) return
  try {
    const s = summariseSendError(err)
    const tenantId = senderContext.hasContext() ? senderContext.getTenantId() : null
    logger.error(`META_SEND_FAILED tenant=${tenantId || 'unknown'} ctx=${ctx} template=${templateName || 'none'} code=${s.code ?? 'none'} subcode=${s.subcode ?? 'none'} http=${s.http ?? 'none'} msg=${s.message}${s.trace ? ` trace=${s.trace}` : ''}`)
    const phoneNumberId = senderContext.hasContext() ? senderContext.getPhoneNumberId() : null
    pool.query(
      `INSERT INTO send_failures (tenant_id, ctx, template_name, meta_code, meta_subcode, http_status, error_message)
       VALUES (COALESCE($1::uuid, (SELECT id FROM tenants WHERE whatsapp_phone_number_id = $2 LIMIT 1)), $3, $4, $5, $6, $7, $8)`,
      [tenantId, phoneNumberId, ctx, templateName || null, s.code, s.subcode, s.http, s.message]
    ).catch(dbErr => {
      logger.warn(`SEND_FAILURE_RECORD_FAILED ctx=${ctx} ${String(dbErr?.message || 'error').slice(0, 120)}`)
    })
  } catch (recordErr) {
    try { logger.warn(`SEND_FAILURE_RECORD_FAILED ctx=${ctx}`) } catch {}
  }
}

// Meta message id of an accepted send. The send functions return Meta's response body, so the id is at messages[0].id.
function extractWamid(result) {
  return result?.messages?.[0]?.id ?? result?.data?.messages?.[0]?.id ?? null
}

// Records the outcome of one send on the stored message row: sent (with the Meta message id) or failed (with the Meta error code).
// A row already marked failed by a status update stays failed. Callers do not await it; it never throws, and the id is never logged.
function recordDelivery(messageId, result, err) {
  try {
    if (!messageId) return
    const update = err
      ? pool.query(
          `UPDATE messages SET delivery_status = 'failed', delivery_error = $2 WHERE id = $1`,
          [messageId, summariseSendError(err).code !== null ? String(summariseSendError(err).code) : 'none']
        )
      : pool.query(
          `UPDATE messages
           SET wa_message_id = COALESCE($2::text, wa_message_id),
               delivery_status = CASE WHEN delivery_status = 'failed' THEN delivery_status ELSE 'sent' END
           WHERE id = $1`,
          [messageId, extractWamid(result)]
        )
    update.catch(dbErr => {
      logger.warn(`MESSAGE_DELIVERY_UPDATE_FAILED ${String(dbErr?.message || 'error').slice(0, 120)}`)
    })
  } catch (recordErr) {
    try { logger.warn('MESSAGE_DELIVERY_UPDATE_FAILED') } catch {}
  }
}

/**
 * Sends a text message via Meta Cloud API
 *
 * @param {string} to - Phone number with country code
 * @param {string} message - Text message to send
 * @returns {Promise<object>} Meta API response
 */
async function sendTextMessage(to, message) {
  try {
    const response = await axios.post(
      `${META_API_URL}/${getPhoneId()}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace('+', ''),
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        }
      }
    )

    logger.info(`Meta message sent to ${maskPhone(to)}`)
    return response.data
  } catch (err) {
    recordSendFailure('text', null, err)
    throw err
  }
}

/**
 * Parses a smb_message_echoes webhook value (messages the clinic sent from the WhatsApp Business app).
 * "to" is the patient, "from" is the clinic, the reverse of a normal inbound message.
 *
 * @param {object} value - changes[].value of the smb_message_echoes field
 * @returns {object|null} { type: 'echo', provider, phoneNumberId, echoes: [...] } or null
 */
function parseEchoEvent(value) {
  const items = Array.isArray(value?.message_echoes) ? value.message_echoes : []
  const echoes = items
    .filter(item => item && item.to && item.id)
    .map(item => ({
      customerPhone: `+${String(item.to).replace(/\D/g, '')}`,
      wamid: item.id,
      timestamp: item.timestamp,
      echoType: item.type || 'unknown',
      text: item.type === 'text' ? (item.text?.body || '') : '',
      originalId: item.revoke?.original_message_id || item.edit?.original_message_id || null
    }))
  if (!echoes.length) return null
  return {
    type: 'echo',
    provider: 'meta',
    phoneNumberId: value?.metadata?.phone_number_id || null,
    echoes
  }
}

/**
 * Parses incoming Meta webhook payload
 * Extracts standardized message object
 *
 * @param {object} payload - Raw Meta webhook body
 * @returns {object|null} Standardized message or null
 */
function parseIncomingMessage(payload) {
  try {
    const entry = payload.entry?.[0]
    const changes = entry?.changes?.[0]
    if (changes?.field === 'smb_message_echoes') return parseEchoEvent(changes.value)
    if (changes?.field && changes.field !== 'messages') return null
    const value = changes?.value
    const message = value?.messages?.[0]

    if (!message) return null
    if (message.type !== 'text' && message.type !== 'interactive' && message.type !== 'button') {
      // Voice notes, images, videos, documents, stickers, locations, contacts, reactions and anything else: a light result with no
      // text and no media id. It is handled completely by media.inbound.js (message.id is the message id, kept only for the dedupe).
      if (!message.id || !message.from) return null
      // Meta "system" events (for example a patient changing their number) are not patient messages: ignored as before
      if (message.type === 'system') return null
      const knownMedia = ['audio', 'image', 'video', 'document', 'sticker', 'location', 'contacts', 'reaction']
      const mediaType = knownMedia.includes(message.type) ? message.type : 'other'
      return {
        kind: 'media',
        mediaType,
        id: message.id,
        messageId: message.id,
        from: `+${message.from}`,
        to: `+${value?.metadata?.display_phone_number}`,
        timestamp: message.timestamp,
        type: mediaType,
        message: '',
        customerName: value?.contacts?.[0]?.profile?.name || '',
        provider: 'meta'
      }
    }

    let messageText = ''
    let interactiveId = null
    let interactiveDescription = null
    if (message.type === 'text') {
      messageText = message.text?.body || ''
    } else if (message.type === 'interactive') {
      messageText = message.interactive?.button_reply?.title
        || message.interactive?.list_reply?.title
        || ''
      interactiveId = message.interactive?.list_reply?.id || message.interactive?.button_reply?.id || null
      interactiveDescription = message.interactive?.list_reply?.description || null
    } else if (message.type === 'button') {
      messageText = message.button?.text || ''
    }

    const contact = value?.contacts?.[0]
    const phoneNumber = `+${message.from}`

    return {
      from: phoneNumber,
      to: `+${value?.metadata?.display_phone_number}`,
      message: messageText,
      messageId: message.id,
      timestamp: message.timestamp,
      type: message.type,
      customerName: contact?.profile?.name || '',
      provider: 'meta',
      interactiveId: interactiveId || null,
      interactiveDescription
    }
  } catch (err) {
    logger.error('Meta parse failed:', err.message)
    return null
  }
}

/**
 * Handles Meta webhook verification
 * Meta sends GET request to verify webhook URL
 *
 * @param {object} query - Request query params
 * @returns {string|null} Challenge string or null
 */
function verifyWebhook(query) {
  const mode = query['hub.mode']
  const token = query['hub.verify_token']
  const challenge = query['hub.challenge']

  if (
    mode === 'subscribe' &&
    token === process.env.META_WEBHOOK_VERIFY_TOKEN
  ) {
    return challenge
  }
  return null
}

/**
 * Sends interactive button message via Meta
 * Used for welcome menu
 * Maximum 3 buttons
 *
 * @param {string} to - Phone number
 * @param {string} bodyText - Message body
 * @param {Array} buttons - Array of button objects
 *   each button: { id, title }
 * @returns {Promise<object>}
 */
async function sendInteractiveButtons(to, bodyText, buttons) {
  try {
    const response = await axios.post(
      `${META_API_URL}/${getPhoneId()}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace('+', ''),
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: {
            buttons: buttons.map(btn => ({
              type: 'reply',
              reply: {
                id: btn.id,
                title: btn.title
              }
            }))
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        }
      }
    )
    logger.info(`Meta interactive buttons sent to ${maskPhone(to)}`)
    return response.data
  } catch (err) {
    recordSendFailure('buttons', null, err)
    throw err
  }
}

/**
 * Sends list message via Meta
 * Used for doctor selection
 * Up to 10 items
 *
 * @param {string} to - Phone number
 * @param {string} bodyText - Message body
 * @param {string} buttonText - Button label (max 20 chars)
 * @param {Array} items - Array of list items
 *   each item: { id, title, description }
 * @returns {Promise<object>}
 */
async function sendListMessage(to, bodyText, buttonText, items, sectionTitle = 'Options') {
  try {
    const response = await axios.post(
      `${META_API_URL}/${getPhoneId()}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace('+', ''),
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: bodyText },
          action: {
            button: buttonText,
            sections: [
              {
                title: sectionTitle,
                rows: items.map(item => ({
                  id: item.id,
                  title: item.title,
                  description: item.description
                }))
              }
            ]
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        }
      }
    )
    logger.info(`Meta list message sent to ${maskPhone(to)}`)
    return response.data
  } catch (err) {
    recordSendFailure('list', null, err)
    throw err
  }
}


async function uploadMedia(fileBuffer, mimeType, filename) {
  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fileBuffer, { filename, contentType: mimeType });
    form.append('messaging_product', 'whatsapp');
    const response = await axios.post(
      `${META_API_URL}/${getPhoneId()}/media`,
      form,
      {
        headers: {
          Authorization: `Bearer ${getToken()}`,
          ...form.getHeaders()
        },
        timeout: META_CALL_TIMEOUT_MS
      }
    );
    logger.info('Media uploaded to Meta:', response.data.id);
    return response.data.id;
  } catch (err) {
    recordSendFailure('media_upload', null, err);
    throw err;
  }
}

async function sendDocument(to, mediaId, filename, caption) {
  try {
    const response = await axios.post(
      `${META_API_URL}/${getPhoneId()}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace('+', ''),
        type: 'document',
        document: {
          id: mediaId,
          filename: filename,
          caption: caption || ''
        }
      },
      {
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        }
      }
    );
    logger.info(`Meta document sent to ${maskPhone(to)}`);
    return response.data;
  } catch (err) {
    recordSendFailure('document', null, err);
    throw err;
  }
}

async function sendContact(to, clinicName, phoneNumber) {
  const waId = phoneNumber.replace(/\D/g, '');
  const url = `${META_API_URL}/${getPhoneId()}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace('+', ''),
    type: 'contacts',
    contacts: [{
      name: {
        formatted_name: clinicName,
        first_name: clinicName
      },
      phones: [{
        phone: phoneNumber,
        type: 'CELL',
        wa_id: waId
      }]
    }]
  };
  try {
    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      }
    });
    logger.info(`Contact card sent to ${maskPhone(to)}`);
  } catch (err) {
    recordSendFailure('contact', null, err);
  }
}

async function sendTemplateMessage(to, templateName, languageCode = 'en', components = []) {
  try {
    const response = await axios.post(
      `${META_API_URL}/${getPhoneId()}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace('+', ''),
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        // A timed-out send may still have been delivered by Meta: callers must never retry it
        timeout: META_CALL_TIMEOUT_MS
      }
    )
    logger.info(`Meta template message sent to ${maskPhone(to)} using template: ${templateName}`)
    return response.data
  } catch (err) {
    recordSendFailure('template', templateName, err)
    throw err
  }
}

module.exports = {
  extractWamid,
  recordDelivery,
  sendTextMessage,
  sendInteractiveButtons,
  sendListMessage,
  parseIncomingMessage,
  verifyWebhook,
  uploadMedia,
  sendDocument,
  sendContact,
  sendTemplateMessage
}

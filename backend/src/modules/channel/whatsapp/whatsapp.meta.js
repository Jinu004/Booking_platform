const axios = require('axios')
const logger = require('../../../utils/logger')
const senderContext = require('./senderContext')

const META_TOKEN = process.env.META_WHATSAPP_TOKEN || ''
const META_PHONE_ID = process.env.META_PHONE_NUMBER_ID || ''
const META_API_URL = 'https://graph.facebook.com/v24.0'

const getPhoneId = () => {
  if (senderContext.hasContext()) {
    const id = senderContext.getPhoneNumberId()
    if (!id) throw new Error('No WhatsApp Phone Number ID set for this clinic - message not sent')
    return id
  }
  return META_PHONE_ID
}

// The clinic's own Meta token when the sender context has one, otherwise the shared env token
const getToken = () => {
  if (senderContext.hasContext()) {
    const tenantToken = senderContext.getAccessToken()
    if (tenantToken) return tenantToken
  }
  return META_TOKEN
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

    logger.info(`Meta message sent to ${to.toString().slice(0, 2)}XXXXXX${to.toString().slice(-3)}`)
    return response.data
  } catch (err) {
    logger.error('Meta send failed:', err.response?.data || err.message)
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
    if (message.type !== 'text' && message.type !== 'interactive' && message.type !== 'button') return null

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
    logger.info(`Meta interactive buttons sent to ${to}`)
    return response.data
  } catch (err) {
    const metaError = err.response?.data?.error;
    logger.error(`Meta interactive buttons failed — code: ${metaError?.code || 'unknown'}, message: ${metaError?.message || err.message}`)
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
    logger.info(`Meta list message sent to ${to}`)
    return response.data
  } catch (err) {
    logger.error('Meta list message failed:', err.response?.data || err.message)
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
        }
      }
    );
    logger.info('Media uploaded to Meta:', response.data.id);
    return response.data.id;
  } catch (err) {
    logger.error('Meta media upload failed:', err.message);
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
    logger.info(`Meta document sent to ${to}`);
    return response.data;
  } catch (err) {
    logger.error('Meta document send failed:', err.message);
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
    logger.info(`Contact card sent to ${to}`);
  } catch (err) {
    logger.error('sendContact failed:', JSON.stringify(err.response?.data || err.message));
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
        }
      }
    )
    logger.info(`Meta template message sent to ${to} using template: ${templateName}`)
    return response.data
  } catch (err) {
    logger.error('Meta template send failed:', err.response?.data || err.message)
    throw err
  }
}

module.exports = {
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

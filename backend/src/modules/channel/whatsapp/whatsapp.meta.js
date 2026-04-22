const axios = require('axios')
const logger = require('../../../utils/logger')

const META_TOKEN = process.env.META_WHATSAPP_TOKEN || ''
const META_PHONE_ID = process.env.META_PHONE_NUMBER_ID || ''
const META_API_URL = 'https://graph.facebook.com/v18.0'

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
      `${META_API_URL}/${META_PHONE_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace('+', ''),
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${META_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )

    logger.info(`Meta message sent to ${to}`)
    return response.data
  } catch (err) {
    logger.error('Meta send failed:', err.message)
    throw err
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
    const value = changes?.value
    const message = value?.messages?.[0]

    if (!message) return null
    if (message.type !== 'text') return null

    const contact = value?.contacts?.[0]
    const phoneNumber = `+${message.from}`

    return {
      from: phoneNumber,
      message: message.text?.body || '',
      messageId: message.id,
      timestamp: message.timestamp,
      type: message.type,
      customerName: contact?.profile?.name || '',
      provider: 'meta'
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
      `${META_API_URL}/${META_PHONE_ID}/messages`,
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
          Authorization: `Bearer ${META_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )
    logger.info(`Meta interactive buttons sent to ${to}`)
    return response.data
  } catch (err) {
    logger.error('Meta interactive buttons failed:', err.message)
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
async function sendListMessage(to, bodyText, buttonText, items) {
  try {
    const response = await axios.post(
      `${META_API_URL}/${META_PHONE_ID}/messages`,
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
                title: 'Available Doctors',
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
          Authorization: `Bearer ${META_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )
    logger.info(`Meta list message sent to ${to}`)
    return response.data
  } catch (err) {
    logger.error('Meta list message failed:', err.message)
    throw err
  }
}

module.exports = {
  sendTextMessage,
  sendInteractiveButtons,
  sendListMessage,
  parseIncomingMessage,
  verifyWebhook
}

const axios = require('axios')
const logger = require('../../../utils/logger')

const WAHA_BASE_URL = process.env.WAHA_BASE_URL
  || 'http://localhost:3000'
const WAHA_API_KEY = process.env.WAHA_API_KEY || ''
const WAHA_SESSION = 'default'

/**
 * Sends a text message via WAHA
 *
 * @param {string} to - Phone number with country code
 * @param {string} message - Text message to send
 * @returns {Promise<object>} WAHA response
 */
async function sendTextMessage(to, message) {
  try {
    const chatId = formatPhoneNumber(to)

    const response = await axios.post(
      `${WAHA_BASE_URL}/api/sendText`,
      {
        session: WAHA_SESSION,
        chatId,
        text: message
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': WAHA_API_KEY
        }
      }
    )

    logger.info(`WAHA message sent to ${to}`)
    return response.data
  } catch (err) {
    logger.error('WAHA send failed:', err.message)
    throw err
  }
}

/**
 * Formats phone number to WhatsApp chat ID format
 * Input: +919847123456 or 9847123456
 * Output: 919847123456@c.us
 *
 * @param {string} phone
 * @returns {string} WhatsApp chat ID
 */
function formatPhoneNumber(phone) {
  const digits = phone.replace(/\D/g, '')
  const withCountry = digits.startsWith('91')
    ? digits
    : `91${digits}`
  return `${withCountry}@c.us`
}

/**
 * Parses incoming WAHA webhook payload
 * Extracts standardized message object
 *
 * @param {object} payload - Raw WAHA webhook body
 * @returns {object|null} Standardized message or null
 */
function parseIncomingMessage(payload) {
  try {
    if (!payload.payload) return null

    const msg = payload.payload
    if (msg.fromMe) return null

    const from = msg.from.replace('@c.us', '')
    const phoneNumber = from.startsWith('91')
      ? `+${from}`
      : `+91${from}`

    return {
      from: phoneNumber,
      message: msg.body || '',
      messageId: msg.id,
      timestamp: msg.timestamp,
      type: msg.type || 'text',
      provider: 'waha'
    }
  } catch (err) {
    logger.error('WAHA parse failed:', err.message)
    return null
  }
}

module.exports = {
  sendTextMessage,
  parseIncomingMessage,
  formatPhoneNumber
}

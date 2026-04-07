const waha = require('./whatsapp.waha')
const meta = require('./whatsapp.meta')
const { randomDelay } = require('../../../utils/delay')
const logger = require('../../../utils/logger')

/**
 * Determines which provider to use
 * Development → WAHA
 * Production → Meta Cloud API
 *
 * @returns {string} 'waha' or 'meta'
 */
function getProvider() {
  return process.env.NODE_ENV === 'production'
    ? 'meta'
    : 'waha'
}

/**
 * Sends a WhatsApp message using correct provider
 * Automatically adds random delay before sending
 * This is the ONLY function other modules should call
 *
 * @param {string} to - Phone number
 * @param {string} message - Text to send
 * @returns {Promise<object>} Provider response
 */
async function sendMessage(to, message) {
  await randomDelay(3000, 8000)

  const provider = getProvider()
  logger.info(`Sending via ${provider} to ${to}`)

  if (provider === 'meta') {
    return meta.sendTextMessage(to, message)
  }
  return waha.sendTextMessage(to, message)
}

/**
 * Parses incoming webhook payload
 * Works for both WAHA and Meta formats
 *
 * @param {object} payload - Raw webhook body
 * @param {string} source - 'waha' or 'meta'
 * @returns {object|null} Standardized message
 */
function parseIncoming(payload, source) {
  if (source === 'meta') {
    return meta.parseIncomingMessage(payload)
  }
  return waha.parseIncomingMessage(payload)
}

module.exports = {
  sendMessage,
  parseIncoming,
  getProvider
}

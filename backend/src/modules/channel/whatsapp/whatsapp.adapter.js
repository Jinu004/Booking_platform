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

/**
 * Sends interactive button message
 * Only available with Meta — falls back to
 * plain text with WAHA
 *
 * @param {string} to
 * @param {string} bodyText
 * @param {Array} buttons - [{ id, title }]
 */
async function sendButtons(to, bodyText, buttons) {
  await randomDelay(2000, 5000)
  const provider = getProvider()

  if (provider === 'meta') {
    return meta.sendInteractiveButtons(to, bodyText, buttons)
  }

  // WAHA fallback — plain text with numbered options
  const numberedText = bodyText + '\n\n' +
    buttons.map((btn, i) => `${i + 1} → ${btn.title}`).join('\n')
  return waha.sendTextMessage(to, numberedText)
}

/**
 * Sends doctor selection list
 * Meta uses list message — WAHA uses plain text
 *
 * @param {string} to
 * @param {string} bodyText
 * @param {Array} items - [{ id, title, description }]
 */
async function sendDoctorList(to, bodyText, items) {
  await randomDelay(2000, 5000)
  const provider = getProvider()

  if (provider === 'meta') {
    return meta.sendListMessage(
      to,
      bodyText,
      'Select Doctor',
      items
    )
  }

  // WAHA fallback — plain text list
  const listText = bodyText + '\n\n' +
    items.map(item =>
      `🩺 ${item.title}\n   ${item.description}`
    ).join('\n\n') +
    '\n\nReply with doctor name'
  return waha.sendTextMessage(to, listText)
}

module.exports = {
  sendMessage,
  sendButtons,
  sendDoctorList,
  parseIncoming,
  getProvider
}

/**
 * Adds random human-like delay before sending
 * WhatsApp messages to avoid ban risk.
 * Never send messages instantly — always delay.
 *
 * @param {number} minMs - Minimum delay in ms (default 5000)
 * @param {number} maxMs - Maximum delay in ms (default 30000)
 * @returns {Promise<void>}
 */
async function randomDelay(minMs = 5000, maxMs = 30000) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
  return new Promise(resolve => setTimeout(resolve, delay))
}

/**
 * Short delay for quick responses (typing indicator feel)
 * Use for simple confirmations
 *
 * @returns {Promise<void>}
 */
async function shortDelay() {
  return randomDelay(2000, 5000)
}

/**
 * Long delay for complex responses
 * Use when AI is processing
 *
 * @returns {Promise<void>}
 */
async function longDelay() {
  return randomDelay(5000, 15000)
}

module.exports = { randomDelay, shortDelay, longDelay }

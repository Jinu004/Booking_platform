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

// Ban protection: at most STAFF_TEMPLATE_DAILY_CAP WhatsApp templates per clinic per day (Asia/Kolkata) may be triggered by staff
// actions (manual, procedure and appointment bookings). Redis key staff_tpl:<tenantId>:<YYYY-MM-DD>, kept 36 hours.
const STAFF_TEMPLATE_DAILY_CAP = 50

/**
 * Reserves one staff-triggered template send for this clinic today. Call it only when a send will really be attempted.
 * Returns { allowed: true, count } when the send may go ahead, { allowed: false, count } when today's cap is already used.
 * Fails open: when Redis is unavailable or errors, the send is allowed (as before this cap existed) and the error is logged.
 */
async function reserveStaffTemplateSend(tenantId) {
  const logger = require('./logger')
  try {
    const redisClient = require('../config/redis')
    if (!redisClient || !redisClient.isReady) {
      logger.warn(`STAFF_TEMPLATE_CAP redis_unavailable tenant=${tenantId} result=allowed`)
      return { allowed: true, count: null }
    }
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const key = `staff_tpl:${tenantId}:${day}`
    const count = await redisClient.incr(key)
    if (count === 1) await redisClient.expire(key, 129600)
    if (count > STAFF_TEMPLATE_DAILY_CAP) {
      // Not sent, so not counted: the reservation is given back
      await redisClient.decr(key)
      logger.warn(`STAFF_TEMPLATE_CAP tenant=${tenantId} count=${count - 1} cap=${STAFF_TEMPLATE_DAILY_CAP} result=skipped`)
      return { allowed: false, count: count - 1 }
    }
    return { allowed: true, count }
  } catch (err) {
    logger.warn(`STAFF_TEMPLATE_CAP redis_error tenant=${tenantId} ${String(err && err.message).slice(0, 100)} result=allowed`)
    return { allowed: true, count: null }
  }
}

module.exports = { randomDelay, shortDelay, longDelay, STAFF_TEMPLATE_DAILY_CAP, reserveStaffTemplateSend }

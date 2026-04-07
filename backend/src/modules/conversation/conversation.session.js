const redis = require('../../config/redis')
const logger = require('../../utils/logger')

const SESSION_TTL = 60 * 60 * 2 // 2 hours in seconds

/**
 * Gets session key for a patient in a tenant
 * Format: session:{tenantId}:{phoneNumber}
 *
 * @param {string} tenantId
 * @param {string} phoneNumber
 * @returns {string} Redis key
 */
function getSessionKey(tenantId, phoneNumber) {
  return `session:${tenantId}:${phoneNumber}`
}

/**
 * Gets existing session or creates new one
 *
 * @param {string} tenantId
 * @param {string} phoneNumber
 * @returns {Promise<object>} Session object
 */
async function getOrCreateSession(tenantId, phoneNumber) {
  try {
    const key = getSessionKey(tenantId, phoneNumber)
    const existing = await redis.get(key)

    if (existing) {
      return JSON.parse(existing)
    }

    const newSession = {
      tenantId,
      phoneNumber,
      state: 'idle',
      step: null,
      data: {},
      messageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    await redis.setEx(key, SESSION_TTL, JSON.stringify(newSession))
    return newSession
  } catch (err) {
    logger.warn('Session get/create failed:', err.message)
    return {
      tenantId,
      phoneNumber,
      state: 'idle',
      step: null,
      data: {},
      messageCount: 0
    }
  }
}

/**
 * Updates session with new data
 * Resets TTL on every update
 *
 * @param {string} tenantId
 * @param {string} phoneNumber
 * @param {object} updates - Fields to update
 * @returns {Promise<object>} Updated session
 */
async function updateSession(tenantId, phoneNumber, updates) {
  try {
    const key = getSessionKey(tenantId, phoneNumber)
    const existing = await getOrCreateSession(tenantId, phoneNumber)

    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString()
    }

    await redis.setEx(key, SESSION_TTL, JSON.stringify(updated))
    return updated
  } catch (err) {
    logger.warn('Session update failed:', err.message)
    return updates
  }
}

/**
 * Clears session — called after booking complete
 * or conversation resolved
 *
 * @param {string} tenantId
 * @param {string} phoneNumber
 * @returns {Promise<void>}
 */
async function clearSession(tenantId, phoneNumber) {
  try {
    const key = getSessionKey(tenantId, phoneNumber)
    await redis.del(key)
  } catch (err) {
    logger.warn('Session clear failed:', err.message)
  }
}

/**
 * Gets all active sessions for a tenant
 * Used by dashboard to show active conversations
 *
 * @param {string} tenantId
 * @returns {Promise<Array>} Array of active sessions
 */
async function getActiveSessions(tenantId) {
  try {
    const pattern = `session:${tenantId}:*`
    const keys = await redis.keys(pattern)

    if (!keys.length) return []

    const sessions = await Promise.all(
      keys.map(async (key) => {
        const data = await redis.get(key)
        return data ? JSON.parse(data) : null
      })
    )

    return sessions.filter(Boolean)
  } catch (err) {
    logger.warn('Get active sessions failed:', err.message)
    return []
  }
}

module.exports = {
  getOrCreateSession,
  updateSession,
  clearSession,
  getActiveSessions
}

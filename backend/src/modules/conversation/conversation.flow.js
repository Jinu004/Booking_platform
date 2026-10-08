const redis = require('../../config/redis')
const logger = require('../../utils/logger')
const { getOrCreateSession } = require('./conversation.session')

const SESSION_TTL = 60 * 60 * 2 // keep in step with conversation.session.js
const FLOW_TTL_MS = 30 * 60 * 1000 // a pending booking step expires after 30 minutes

function getSessionKey(tenantId, phoneNumber) {
  return `session:${tenantId}:${phoneNumber}`
}

/**
 * Reads the pending booking flow stored in the session.
 * Returns { state, step, data, expired } or null when no flow is stored (idle).
 * `expired` is true once data.expiresAt has passed; callers must ignore expired flows.
 * Never throws.
 */
async function getFlow(tenantId, phoneNumber) {
  try {
    const raw = await redis.get(getSessionKey(tenantId, phoneNumber))
    if (!raw) return null
    const session = JSON.parse(raw)
    if (!session.state || session.state === 'idle') return null
    const expiresAt = session.data && session.data.expiresAt
    const expired = !expiresAt || new Date(expiresAt).getTime() < Date.now()
    return { state: session.state, step: session.step || null, data: session.data || {}, expired }
  } catch (err) {
    logger.warn('Booking flow get failed:', err.message)
    return null
  }
}

/**
 * Stores the booking flow state in the session.
 * Re-reads the session immediately before writing and replaces only
 * state, step, data and updatedAt, so messageCount, lastMessage,
 * lastMessageAt and conversationId are preserved. Never throws.
 *
 * @param {string} tenantId
 * @param {string} phoneNumber
 * @param {object} flow - { state, step?, kind, doctorId, doctorName, date, sessionStart }
 * @returns {Promise<object|null>} Stored { state, step, data } or null on failure
 */
async function setFlow(tenantId, phoneNumber, flow) {
  try {
    const key = getSessionKey(tenantId, phoneNumber)
    const raw = await redis.get(key)
    const session = raw ? JSON.parse(raw) : await getOrCreateSession(tenantId, phoneNumber)

    const data = {
      kind: flow.kind || null,
      doctorId: flow.doctorId || null,
      doctorName: flow.doctorName || null,
      date: flow.date || null,
      sessionStart: flow.sessionStart || null,
      expiresAt: new Date(Date.now() + FLOW_TTL_MS).toISOString()
    }
    const updated = {
      ...session,
      state: flow.state,
      step: flow.step || null,
      data,
      updatedAt: new Date().toISOString()
    }

    await redis.setEx(key, SESSION_TTL, JSON.stringify(updated))
    return { state: updated.state, step: updated.step, data }
  } catch (err) {
    logger.warn('Booking flow set failed:', err.message)
    return null
  }
}

/**
 * Returns the session to idle without deleting it, so the other
 * session fields survive. Never throws.
 */
async function clearFlow(tenantId, phoneNumber) {
  try {
    const key = getSessionKey(tenantId, phoneNumber)
    const raw = await redis.get(key)
    if (!raw) return null
    const session = JSON.parse(raw)
    const updated = {
      ...session,
      state: 'idle',
      step: null,
      data: {},
      updatedAt: new Date().toISOString()
    }
    await redis.setEx(key, SESSION_TTL, JSON.stringify(updated))
    return { state: 'idle', step: null, data: {} }
  } catch (err) {
    logger.warn('Booking flow clear failed:', err.message)
    return null
  }
}

module.exports = { getFlow, setFlow, clearFlow }

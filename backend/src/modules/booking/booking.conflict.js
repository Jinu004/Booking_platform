const redis = require('../../config/redis');
const logger = require('../../utils/logger');

const LOCK_TTL = 300; // 5 minutes in seconds

/**
 * Acquires a pending lock for a slot
 * Prevents race conditions on simultaneous bookings
 * Uses Redis SET NX (set if not exists)
 *
 * @param {string} tenantId
 * @param {string} doctorId
 * @param {string} date - YYYY-MM-DD
 * @param {string} requestId - unique ID for this request
 * @returns {Promise<boolean>} true if lock acquired
 */
async function acquireSlotLock(tenantId, doctorId, date, requestId) {
  try {
    const key = `lock:${tenantId}:${doctorId}:${date}`;
    // Upstash/Redis v4 uses { NX: true, EX: timeInSeconds }
    const result = await redis.set(key, requestId, { NX: true, EX: LOCK_TTL });
    return result === 'OK';
  } catch (err) {
    logger.warn(`Lock acquire failed: ${err.message}`);
    return true; // fail open — allow booking attempt
  }
}

/**
 * Releases a slot lock after booking confirmed
 * Only releases if this request owns the lock
 *
 * @param {string} tenantId
 * @param {string} doctorId
 * @param {string} date
 * @param {string} requestId
 * @returns {Promise<void>}
 */
async function releaseSlotLock(tenantId, doctorId, date, requestId) {
  try {
    const key = `lock:${tenantId}:${doctorId}:${date}`;
    const currentValue = await redis.get(key);
    if (currentValue === requestId) {
      await redis.del(key);
    }
  } catch (err) {
    logger.warn(`Lock release failed: ${err.message}`);
  }
}

/**
 * Checks if a doctor has capacity for today
 * Combines database count with Redis pending locks
 *
 * @param {object} pool
 * @param {string} tenantId
 * @param {string} doctorId
 * @param {number} maxTokens
 * @returns {Promise<object>} {
 *   available: boolean,
 *   tokensIssued: number,
 *   tokensRemaining: number
 * }
 */
async function checkDoctorCapacity(pool, tenantId, doctorId, maxTokens) {
  const BookingModel = require('./booking.model');
  const tokensIssued = await BookingModel.getDoctorTokenCount(pool, tenantId, doctorId);
  const remaining = maxTokens - tokensIssued;
  
  return {
    available: remaining > 0,
    tokensIssued,
    tokensRemaining: remaining > 0 ? remaining : 0
  };
}

/**
 * Gets next available token number for a doctor
 * Atomically increments using Redis counter
 *
 * @param {string} tenantId
 * @param {string} doctorId
 * @param {string} date
 * @returns {Promise<number>} Next token number
 */
async function getNextTokenNumber(tenantId, doctorId, date) {
  try {
    const key = `token:${tenantId}:${doctorId}:${date}`;
    const token = await redis.incr(key);
    if (token === 1) {
      // Set expiry to 24 hours (86400 seconds) for the first token
      await redis.expire(key, 86400); 
    }
    return token;
  } catch (err) {
    logger.error(`Failed to generate token number: ${err.message}`);
    // Fallback: throw error, will be handled by caller
    throw err;
  }
}

module.exports = {
  acquireSlotLock,
  releaseSlotLock,
  checkDoctorCapacity,
  getNextTokenNumber
};

const pool = require('../../config/database');
const BookingModel = require('./booking.model');
const ConflictEngine = require('./booking.conflict');
const logger = require('../../utils/logger');
const { v4: uuidv4 } = require('uuid');
const tenantQuery = require('../../utils/tenantQuery');

/**
 * Creates a booking with conflict prevention
 * Full flow:
 * 1. Check doctor availability
 * 2. Acquire slot lock
 * 3. Get next token number
 * 4. Create booking record
 * 5. Create token record
 * 6. Release lock on error
 *
 * @param {string} tenantId
 * @param {object} bookingData - {
 *   customerId, doctorId, source,
 *   bookingDate, notes, conversationId
 * }
 * @returns {Promise<object>} Created booking with token
 */
async function createBookingWithToken(tenantId, bookingData) {
  const { doctorId, bookingDate } = bookingData;
  const requestId = uuidv4();
  let lockAcquired = false;

  try {
    // 1. Check doctor availability
    const doctorRes = await pool.query(
      `SELECT max_tokens_daily, available_today FROM clinic_doctors WHERE id = $1 AND tenant_id = $2`,
      [doctorId, tenantId]
    );

    if (doctorRes.rows.length === 0) {
      throw new Error('Doctor not found');
    }

    const doctor = doctorRes.rows[0];
    if (!doctor.available_today) {
      throw new Error('Doctor is not available today');
    }

    const maxTokens = doctor.max_tokens_daily || 30;
    const capacity = await ConflictEngine.checkDoctorCapacity(pool, tenantId, doctorId, maxTokens);

    if (!capacity.available) {
      throw new Error('Doctor is fully booked for today');
    }

    // 2. Acquire slot lock
    lockAcquired = await ConflictEngine.acquireSlotLock(tenantId, doctorId, bookingDate, requestId);
    if (!lockAcquired) {
      // Failed to acquire lock, someone is booking currently, but failing open
      logger.warn(`Could not acquire slot lock for doctor ${doctorId}, proceeding anyway`);
    }

    // 3. Get next token number
    const tokenNumber = await ConflictEngine.getNextTokenNumber(tenantId, doctorId, bookingDate);

    // 4. Create booking record
    const booking = await BookingModel.createBooking(pool, tenantId, {
      ...bookingData,
      tokenNumber
    });

    // 5. Create token record
    const tokenSql = `
      INSERT INTO clinic_tokens 
      (tenant_id, booking_id, doctor_id, token_number, status) 
      VALUES ($1, $2, $3, $4, 'waiting') 
      RETURNING *
    `;
    const tokenRes = await tenantQuery(tenantId, pool, tokenSql, [booking.id, doctorId, tokenNumber]);

    return {
      booking,
      token: tokenRes.rows[0]
    };
  } catch (error) {
    logger.error(`Error in createBookingWithToken: ${error.message}`);
    throw error;
  } finally {
    // 6. Release lock
    if (lockAcquired) {
      await ConflictEngine.releaseSlotLock(tenantId, doctorId, bookingDate, requestId);
    }
  }
}

/**
 * Gets bookings for dashboard with pagination
 *
 * @param {string} tenantId
 * @param {object} options - {
 *   date, status, doctorId, customerId, page, limit
 * }
 * @returns {Promise<object>} { bookings, total, page }
 */
async function getBookingsDashboard(tenantId, options) {
  const { date, status, doctorId, customerId, page = 1, limit = 10 } = options;
  const bookings = await BookingModel.getBookings(pool, tenantId, {
    date, status, doctorId, customerId, page: parseInt(page), limit: parseInt(limit)
  });

  // Calculate total for pagination (simplistic here, a real count query is better)
  let countSql = `SELECT COUNT(*) FROM bookings WHERE tenant_id = $1`;
  const params = [tenantId];
  let paramCount = 2;
  if (date) { countSql += ` AND booking_date = $${paramCount++}`; params.push(date); }
  if (status) { countSql += ` AND status = $${paramCount++}`; params.push(status); }
  if (doctorId) { countSql += ` AND doctor_id = $${paramCount++}`; params.push(doctorId); }
  if (customerId) { countSql += ` AND customer_id = $${paramCount++}`; params.push(customerId); }

  const countRes = await pool.query(countSql, params);
  const total = parseInt(countRes.rows[0].count);

  return { bookings, total, page: parseInt(page), limit: parseInt(limit) };
}

/**
 * Cancels booking with business rules
 * Cannot cancel if consultation already started
 * Sends cancellation notification (stub for Sprint 5)
 *
 * @param {string} tenantId
 * @param {string} bookingId
 * @param {string} cancelledBy - 'patient' or 'staff'
 * @returns {Promise<object>} Cancelled booking
 */
async function cancelBookingWithRules(tenantId, bookingId, cancelledBy) {
  const tokenSql = `SELECT status FROM clinic_tokens WHERE tenant_id = $1 AND booking_id = $2`;
  const tokenRes = await pool.query(tokenSql, [tenantId, bookingId]);
  
  if (tokenRes.rows.length > 0) {
    const tokenStatus = tokenRes.rows[0].status;
    if (tokenStatus === 'in_progress' || tokenStatus === 'done') {
      throw new Error(`Cannot cancel booking. Consultation is ${tokenStatus}.`);
    }
  }

  const cancelledBooking = await BookingModel.cancelBooking(pool, tenantId, bookingId);
  
  // TODO: Sprint 5 notification logic here
  logger.info(`Booking ${bookingId} cancelled by ${cancelledBy}`);

  return cancelledBooking;
}

/**
 * Marks booking as completed
 * Updates token status to done
 * Records consultation end time
 *
 * @param {string} tenantId
 * @param {string} bookingId
 * @returns {Promise<object>}
 */
async function completeBooking(tenantId, bookingId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const bookingSql = `
      UPDATE bookings 
      SET status = 'completed', updated_at = NOW() 
      WHERE tenant_id = $1 AND id = $2 
      RETURNING *
    `;
    const bookingRes = await tenantQuery(tenantId, client, bookingSql, [bookingId]);
    
    const tokenSql = `
      UPDATE clinic_tokens 
      SET status = 'done', consultation_end = NOW() 
      WHERE tenant_id = $1 AND booking_id = $2
    `;
    await tenantQuery(tenantId, client, tokenSql, [bookingId]);

    await client.query('COMMIT');
    return bookingRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Marks patient as no show
 *
 * @param {string} tenantId
 * @param {string} bookingId
 * @returns {Promise<object>}
 */
async function markNoShow(tenantId, bookingId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const bookingSql = `
      UPDATE bookings 
      SET status = 'noshow', updated_at = NOW() 
      WHERE tenant_id = $1 AND id = $2 
      RETURNING *
    `;
    const bookingRes = await tenantQuery(tenantId, client, bookingSql, [bookingId]);
    
    const tokenSql = `
      UPDATE clinic_tokens 
      SET status = 'cancelled' 
      WHERE tenant_id = $1 AND booking_id = $2
    `;
    await tenantQuery(tenantId, client, tokenSql, [bookingId]);

    await client.query('COMMIT');
    return bookingRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gets booking statistics for dashboard
 * Returns counts by status for today
 *
 * @param {string} tenantId
 * @returns {Promise<object>} {
 *   total, confirmed, completed,
 *   cancelled, noshow, pending
 * }
 */
async function getBookingStats(tenantId) {
  const sql = `
    SELECT status, COUNT(*) as count 
    FROM bookings 
    WHERE tenant_id = $1 AND booking_date = CURRENT_DATE
    GROUP BY status
  `;
  const result = await pool.query(sql, [tenantId]);
  
  const stats = {
    total: 0,
    confirmed: 0,
    completed: 0,
    cancelled: 0,
    noshow: 0,
    pending: 0
  };

  result.rows.forEach(row => {
    const count = parseInt(row.count);
    stats.total += count;
    if (stats[row.status] !== undefined) {
      stats[row.status] = count;
    }
  });

  return stats;
}

module.exports = {
  createBookingWithToken,
  getBookingsDashboard,
  cancelBookingWithRules,
  completeBooking,
  markNoShow,
  getBookingStats
};

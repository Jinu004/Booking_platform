const tenantQuery = require('../../utils/tenantQuery');

/**
 * Creates a new booking record
 * @param {object} pool
 * @param {string} tenantId
 * @param {object} bookingData - {
 *   customerId, doctorId, conversationId,
 *   source, bookingDate, slotTime,
 *   tokenNumber, notes
 * }
 * @returns {Promise<object>} Created booking
 */
async function createBooking(pool, tenantId, bookingData) {
  const { customerId, doctorId, conversationId, source, bookingDate, slotTime, tokenNumber, notes } = bookingData;
  const sql = `
    INSERT INTO bookings 
    (tenant_id, customer_id, doctor_id, conversation_id, source, booking_date, slot_time, token_number, notes) 
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
    RETURNING *
  `;
  const result = await tenantQuery(tenantId, pool, sql, [
    customerId || null,
    doctorId || null,
    conversationId || null,
    source || 'whatsapp',
    bookingDate,
    slotTime || null,
    tokenNumber || null,
    notes || null
  ]);
  return result.rows[0];
}

/**
 * Gets booking by ID scoped to tenant
 * @param {object} pool
 * @param {string} tenantId
 * @param {string} bookingId
 * @returns {Promise<object|null>}
 */
async function getBookingById(pool, tenantId, bookingId) {
  const sql = `
    SELECT b.*, c.name AS patient_name, c.phone AS patient_phone, cd.name AS doctor_name 
    FROM bookings b
    LEFT JOIN customers c ON c.id = b.customer_id
    LEFT JOIN clinic_doctors cd ON cd.id = b.doctor_id
    WHERE b.tenant_id = $1 AND b.id = $2
  `;
  const result = await tenantQuery(tenantId, pool, sql, [bookingId]);
  return result.rows.length ? result.rows[0] : null;
}

/**
 * Gets all bookings for tenant with filters
 * @param {object} pool
 * @param {string} tenantId
 * @param {object} filters - {
 *   date, status, doctorId, customerId
 * }
 * @returns {Promise<Array>}
 */
async function getBookings(pool, tenantId, filters = {}) {
  let sql = `
    SELECT b.*, c.name AS patient_name, c.phone AS patient_phone, cd.name AS doctor_name
    FROM bookings b
    LEFT JOIN customers c ON c.id = b.customer_id
    LEFT JOIN clinic_doctors cd ON cd.id = b.doctor_id
    WHERE b.tenant_id = $1
  `;
  const params = [];
  let paramCount = 2; // $1 is tenantId

  if (filters.date) {
    sql += ` AND b.booking_date = $${paramCount}`;
    params.push(filters.date);
    paramCount++;
  }
  if (filters.status) {
    sql += ` AND b.status = $${paramCount}`;
    params.push(filters.status);
    paramCount++;
  }
  if (filters.doctorId) {
    sql += ` AND b.doctor_id = $${paramCount}`;
    params.push(filters.doctorId);
    paramCount++;
  }
  if (filters.customerId) {
    sql += ` AND b.customer_id = $${paramCount}`;
    params.push(filters.customerId);
    paramCount++;
  }
  
  if (filters.page && filters.limit) {
    sql += ` ORDER BY b.booking_date DESC, b.token_number ASC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(filters.limit, (filters.page - 1) * filters.limit);
  } else {
    sql += ` ORDER BY b.booking_date DESC, b.token_number ASC`;
  }

  const result = await tenantQuery(tenantId, pool, sql, params);
  return result.rows;
}

/**
 * Gets bookings for a specific date
 * Joins with customers and clinic_doctors tables
 * Returns full booking details
 * @param {object} pool
 * @param {string} tenantId
 * @param {string} date - YYYY-MM-DD format
 * @returns {Promise<Array>}
 */
async function getBookingsByDate(pool, tenantId, date) {
  const sql = `
    SELECT b.*, c.name AS patient_name, c.phone AS patient_phone, cd.name AS doctor_name, cd.specialization 
    FROM bookings b
    LEFT JOIN customers c ON c.id = b.customer_id
    LEFT JOIN clinic_doctors cd ON cd.id = b.doctor_id
    WHERE b.tenant_id = $1 AND b.booking_date = $2
    ORDER BY b.token_number ASC
  `;
  const result = await tenantQuery(tenantId, pool, sql, [date]);
  return result.rows;
}

/**
 * Updates booking status
 * @param {object} pool
 * @param {string} tenantId
 * @param {string} bookingId
 * @param {string} status - pending|confirmed|cancelled|completed|noshow
 * @returns {Promise<object>}
 */
async function updateBookingStatus(pool, tenantId, bookingId, status) {
  const sql = `
    UPDATE bookings 
    SET status = $2, updated_at = NOW() 
    WHERE tenant_id = $1 AND id = $3 
    RETURNING *
  `;
  const result = await tenantQuery(tenantId, pool, sql, [status, bookingId]);
  return result.rows[0];
}

/**
 * Gets today's booking count for a doctor
 * Used by AI engine to check availability
 * @param {object} pool
 * @param {string} tenantId
 * @param {string} doctorId
 * @returns {Promise<number>}
 */
async function getDoctorTokenCount(pool, tenantId, doctorId) {
  const sql = `
    SELECT COUNT(*) AS total 
    FROM bookings 
    WHERE tenant_id = $1 AND doctor_id = $2 AND booking_date = CURRENT_DATE 
    AND status != 'cancelled'
  `;
  const result = await tenantQuery(tenantId, pool, sql, [doctorId]);
  return parseInt(result.rows[0].total || 0);
}

/**
 * Gets upcoming bookings for a customer
 * @param {object} pool
 * @param {string} tenantId
 * @param {string} customerId
 * @returns {Promise<Array>}
 */
async function getCustomerUpcomingBookings(pool, tenantId, customerId) {
  const sql = `
    SELECT b.*, cd.name AS doctor_name, cd.specialization 
    FROM bookings b
    LEFT JOIN clinic_doctors cd ON cd.id = b.doctor_id
    WHERE b.tenant_id = $1 AND b.customer_id = $2 
    AND b.booking_date >= CURRENT_DATE 
    AND b.status != 'cancelled'
    ORDER BY b.booking_date ASC, b.token_number ASC
  `;
  const result = await tenantQuery(tenantId, pool, sql, [customerId]);
  return result.rows;
}

/**
 * Cancels a booking and its associated token
 * Updates both bookings and clinic_tokens tables
 * @param {object} pool
 * @param {string} tenantId
 * @param {string} bookingId
 * @returns {Promise<object>}
 */
async function cancelBooking(pool, tenantId, bookingId) {
  // We should update the booking status to cancelled. The associated token will also be updated in clinic_tokens
  // but let's do this in a single query transaction or multiple queries.
  // Actually, this function is supposed to cancel the booking. The model function will just execute queries.
  // Using explicit transaction here, passing pool.client would be better, but the signature has pool.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const bookingSql = `
      UPDATE bookings 
      SET status = 'cancelled', updated_at = NOW() 
      WHERE tenant_id = $1 AND id = $2 
      RETURNING *
    `;
    const bookingRes = await tenantQuery(tenantId, client, bookingSql, [bookingId]);
    
    if (bookingRes.rows.length) {
      const tokenSql = `
        UPDATE clinic_tokens 
        SET status = 'cancelled' 
        WHERE tenant_id = $1 AND booking_id = $2
      `;
      await tenantQuery(tenantId, client, tokenSql, [bookingId]);
    }

    await client.query('COMMIT');
    return bookingRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createBooking,
  getBookingById,
  getBookings,
  getBookingsByDate,
  updateBookingStatus,
  getDoctorTokenCount,
  getCustomerUpcomingBookings,
  cancelBooking
};

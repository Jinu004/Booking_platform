const tenantQuery = require('../../../utils/tenantQuery');

/**
 * Gets all doctors for a tenant
 * @param {object} pool
 * @param {string} tenantId
 * @param {boolean} availableOnly
 * @returns {Promise<Array>}
 */
async function getDoctors(pool, tenantId, availableOnly) {
  let sql = `SELECT * FROM clinic_doctors WHERE tenant_id = $1 AND leave_days != 999`;
  const params = [];
  let paramCount = 2;

  if (availableOnly !== undefined) {
    sql += ` AND available_today = $${paramCount}`;
    params.push(availableOnly);
  }

  sql += ` ORDER BY name ASC`;
  const result = await tenantQuery(tenantId, pool, sql, params);
  return result.rows;
}

/**
 * Gets doctor by ID
 */
async function getDoctorById(pool, tenantId, doctorId) {
  const sql = `SELECT * FROM clinic_doctors WHERE tenant_id = $1 AND id = $2`;
  const result = await tenantQuery(tenantId, pool, sql, [doctorId]);
  return result.rows.length ? result.rows[0] : null;
}

/**
 * Creates a new doctor
 */
async function createDoctor(pool, tenantId, doctorData) {
  const { name, specialization, phone, email, qualification, maxTokensDaily, consultationFee } = doctorData;
  const sql = `
    INSERT INTO clinic_doctors (tenant_id, name, specialization, phone, email, qualification, max_tokens_daily, consultation_fee)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;
  const result = await tenantQuery(tenantId, pool, sql, [
    name,
    specialization || null,
    phone || null,
    email || null,
    qualification || null,
    maxTokensDaily || 30,
    consultationFee || 0
  ]);
  return result.rows[0];
}

/**
 * Updates doctor availability
 * Used by staff to mark doctor present/absent
 */
async function updateDoctorAvailability(pool, tenantId, doctorId, available, leaveDays) {
  const sql = `
    UPDATE clinic_doctors 
    SET available_today = $2, leave_days = $3 
    WHERE tenant_id = $1 AND id = $4
    RETURNING *
  `;
  const result = await tenantQuery(tenantId, pool, sql, [available, leaveDays || 0, doctorId]);
  return result.rows.length ? result.rows[0] : null;
}

/**
 * Gets doctor schedule
 * Returns day_of_week and time slots
 */
async function getDoctorSchedule(pool, tenantId, doctorId) {
  const sql = `SELECT * FROM doctor_schedules WHERE tenant_id = $1 AND doctor_id = $2 ORDER BY day_of_week`;
  const result = await tenantQuery(tenantId, pool, sql, [doctorId]);
  return result.rows;
}

/**
 * Adds doctor leave date
 */
async function addDoctorLeave(pool, tenantId, doctorId, leaveDate, reason) {
  const sql = `
    INSERT INTO doctor_leaves (tenant_id, doctor_id, leave_date, reason) 
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  const result = await tenantQuery(tenantId, pool, sql, [doctorId, leaveDate, reason || null]);
  return result.rows[0];
}

/**
 * Gets token queue for today
 */
async function getTokenQueue(pool, tenantId) {
  const sql = `
    SELECT ct.*, b.notes, 
           c.name AS patient_name, 
           cd.name AS doctor_name
    FROM clinic_tokens ct
    JOIN bookings b ON b.id = ct.booking_id
    LEFT JOIN customers c ON c.id = b.customer_id
    JOIN clinic_doctors cd ON cd.id = ct.doctor_id
    WHERE ct.tenant_id = $1
    AND ct.status != 'cancelled'
    AND ct.issued_at >= CURRENT_DATE
    AND ct.issued_at < CURRENT_DATE + INTERVAL '1 day'
    ORDER BY ct.token_number ASC
  `
  const result = await tenantQuery(tenantId, pool, sql, [])
  return result.rows
}
/**
 * Updates token status
 */
async function updateTokenStatus(pool, tenantId, tokenId, status) {
  const sql = `
    UPDATE clinic_tokens 
    SET status = $2 
    WHERE tenant_id = $1 AND id = $3
    RETURNING *
  `;
  const result = await tenantQuery(tenantId, pool, sql, [status, tokenId]);
  return result.rows.length ? result.rows[0] : null;
}

module.exports = {
  getDoctors,
  getDoctorById,
  createDoctor,
  updateDoctorAvailability,
  getDoctorSchedule,
  addDoctorLeave,
  getTokenQueue,
  updateTokenStatus
};

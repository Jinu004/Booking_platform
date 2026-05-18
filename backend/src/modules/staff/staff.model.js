const tenantQuery = require('../../utils/tenantQuery')

/**
 * Creates a new staff member
 * @param {object} pool
 * @param {string} tenantId
 * @param {object} staffData
 * @returns {Promise<object>}
 */
async function createStaff(pool, tenantId, staffData) {
  const { name, role, email, phone, password_hash, doctor_id } = staffData
  const query = `
    INSERT INTO staff (tenant_id, name, role, email, phone, password_hash, is_active, doctor_id)
    VALUES ($1, $2, $3, $4, $5, $6, true, $7)
    RETURNING *
  `
  const params = [name, role, email || null, phone || null, password_hash || null, doctor_id || null]
  const result = await tenantQuery(tenantId, pool, query, params)
  return result.rows[0]
}

/**
 * Gets all staff for tenant
 * @param {object} pool
 * @param {string} tenantId
 * @returns {Promise<Array>}
 */
async function getStaff(pool, tenantId) {
  const query = 'SELECT * FROM staff WHERE tenant_id = $1 ORDER BY created_at DESC'
  const result = await tenantQuery(tenantId, pool, query, [])
  return result.rows
}

/**
 * Gets staff by ID
 */
async function getStaffById(pool, tenantId, staffId) {
  const query = 'SELECT * FROM staff WHERE tenant_id = $1 AND id = $2'
  const result = await tenantQuery(tenantId, pool, query, [staffId])
  return result.rows[0]
}

/**
 * Gets staff by Clerk user ID
 */
async function getStaffByClerkId(pool, clerkUserId) {
  const query = 'SELECT * FROM staff WHERE clerk_user_id = $1'
  const result = await pool.query(query, [clerkUserId])
  return result.rows[0]
}

/**
 * Updates staff member fields.
 *
 * tenantQuery prepends tenantId as $1, so the params array starts with
 * staffId as $2 and each update value follows from $3 onward.
 * paramNum starts at 3 and is incremented per field — clause is built
 * before the push so the index is always in sync with the value position.
 */
async function updateStaff(pool, tenantId, staffId, updates) {
  const allowedFields = ['name', 'role', 'email', 'phone', 'clerk_user_id', 'is_active', 'doctor_id']

  const setClauses = []
  const params = [staffId]  // becomes $2 after tenantQuery prepends tenantId as $1
  let paramNum = 3           // first update field uses $3

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      setClauses.push(`${key} = $${paramNum}`)
      params.push(value)
      paramNum++
    }
  }

  if (setClauses.length === 0) return null

  const query = `
    UPDATE staff
    SET ${setClauses.join(', ')}
    WHERE tenant_id = $1 AND id = $2
    RETURNING *
  `
  const result = await tenantQuery(tenantId, pool, query, params)
  return result.rows[0]
}

/**
 * Updates staff status
 */
async function updateStaffStatus(pool, tenantId, staffId, status) {
  const query = `
    UPDATE staff SET is_active = $2 WHERE tenant_id = $1 AND id = $3 RETURNING *
  `
  const result = await tenantQuery(tenantId, pool, query, [status, staffId])
  return result.rows[0]
}

/**
 * Deletes staff member (Soft delete) and invalidates all active sessions
 */
async function deleteStaff(pool, tenantId, staffId) {
  const query = `
    UPDATE staff SET is_active = false WHERE tenant_id = $1 AND id = $2 RETURNING *
  `
  const result = await tenantQuery(tenantId, pool, query, [staffId])
  if (result.rows[0]) {
    await pool.query('DELETE FROM auth_sessions WHERE staff_id = $1', [staffId])
  }
  return result.rows[0]
}

module.exports = {
  createStaff,
  getStaff,
  getStaffById,
  getStaffByClerkId,
  updateStaff,
  updateStaffStatus,
  deleteStaff
}

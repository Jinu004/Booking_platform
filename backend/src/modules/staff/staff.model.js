const tenantQuery = require('../../utils/tenantQuery')

/**
 * Creates a new staff member
 * @param {object} pool
 * @param {string} tenantId
 * @param {object} staffData
 * @returns {Promise<object>}
 */
async function createStaff(pool, tenantId, staffData) {
  const { name, role, email, phone, clerkUserId } = staffData
  const query = `
    INSERT INTO staff (tenant_id, name, role, email, phone, clerk_user_id, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, true)
    RETURNING *
  `
  const params = [name, role, email || null, phone || null, clerkUserId || null]
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
 * Updates staff member
 */
async function updateStaff(pool, tenantId, staffId, updates) {
  const allowedFields = ['name', 'role', 'email', 'phone', 'clerk_user_id']
  
  const setClauses = []
  const params = []
  let paramIndex = 3 // starts from 3 because $1=tenant_id, $2=staffId

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      setClauses.push(`${key} = $${paramIndex}`)
      params.push(value)
      paramIndex++
    }
  }

  if (setClauses.length === 0) return null

  const query = `
    UPDATE staff
    SET ${setClauses.join(', ')}
    WHERE tenant_id = $1 AND id = $2
    RETURNING *
  `
  const result = await tenantQuery(tenantId, pool, query, params, true) // requires special handling to insert id before params... actually tenantQuery adds tenant_id as $1, but my query starts manual params from $3, wait.
  // tenantQuery signature: tenantQuery(tenantId, pool, queryText, queryParams)
  // tenantQuery rewrites `$1` to `$1` (tenantId) and shifts the rest.
  return result.rows[0]
}

// Rewriting updateStaff correctly:
async function updateStaffFixed(pool, tenantId, staffId, updates) {
  const allowedFields = ['name', 'role', 'email', 'phone', 'clerk_user_id', 'is_active']
  
  const setClauses = []
  const params = [staffId] // $2 after tenantQuery injects
  let paramIndex = 2 // $1 is tenantId, $2 is staffId, so next is 3, but length is 1, so indices in array... wait

  // Since tenantQuery automatically prepends tenantId and we replace $N with $(N+1)
  // If query is UPDATE staff SET name = $3 WHERE tenant_id = $1 AND id = $2
  // Then params array passed to tenantQuery should be [staffId, newName]
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      params.push(value)
      setClauses.push(`${key} = $${params.length + 1}`) // index conceptually before shifting 
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
 * Deletes staff member (Soft delete)
 */
async function deleteStaff(pool, tenantId, staffId) {
  const query = `
    UPDATE staff SET is_active = false WHERE tenant_id = $1 AND id = $2 RETURNING *
  `
  const result = await tenantQuery(tenantId, pool, query, [staffId])
  return result.rows[0]
}

module.exports = {
  createStaff,
  getStaff,
  getStaffById,
  getStaffByClerkId,
  updateStaff: updateStaffFixed,
  updateStaffStatus,
  deleteStaff
}

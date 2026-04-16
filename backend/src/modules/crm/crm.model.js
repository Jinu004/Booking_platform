const tenantQuery = require('../../utils/tenantQuery');

/**
 * Creates or updates customer record
 * Uses phone number as unique identifier per tenant
 * Upsert — insert if not exists, update if exists
 *
 * @param {object} pool
 * @param {string} tenantId
 * @param {object} customerData - {
 *   name, phone, email, dateOfBirth, notes
 * }
 * @returns {Promise<object>} Customer record
 */
async function upsertCustomer(pool, tenantId, customerData) {
  const { name, phone, email, dateOfBirth, notes } = customerData;
  const sql = `
    INSERT INTO customers (tenant_id, name, phone, email, date_of_birth, notes, last_seen)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (tenant_id, phone) 
    DO UPDATE SET 
      name = COALESCE(EXCLUDED.name, customers.name),
      email = COALESCE(EXCLUDED.email, customers.email),
      date_of_birth = COALESCE(EXCLUDED.date_of_birth, customers.date_of_birth),
      notes = COALESCE(EXCLUDED.notes, customers.notes),
      last_seen = NOW()
    RETURNING *
  `;
  const result = await tenantQuery(tenantId, pool, sql, [
    name || null,
    phone,
    email || null,
    dateOfBirth || null,
    notes || null
  ]);
  return result.rows[0];
}

/**
 * Gets customer by phone number
 * Used by webhook to identify returning patients
 *
 * @param {object} pool
 * @param {string} tenantId
 * @param {string} phone
 * @returns {Promise<object|null>}
 */
async function getCustomerByPhone(pool, tenantId, phone) {
  const sql = `SELECT * FROM customers WHERE tenant_id = $1 AND phone = $2 LIMIT 1`;
  const result = await tenantQuery(tenantId, pool, sql, [phone]);
  return result.rows.length ? result.rows[0] : null;
}

/**
 * Gets customer by ID
 */
async function getCustomerById(pool, tenantId, customerId) {
  const sql = `SELECT * FROM customers WHERE tenant_id = $1 AND id = $2`;
  const result = await tenantQuery(tenantId, pool, sql, [customerId]);
  return result.rows.length ? result.rows[0] : null;
}

/**
 * Gets all customers for tenant
 * With search by name or phone
 *
 * @param {object} pool
 * @param {string} tenantId
 * @param {object} options - { search, page, limit }
 * @returns {Promise<object>} { customers, total }
 */
async function getCustomers(pool, tenantId, options) {
  const { search, page = 1, limit = 10 } = options;
  let sql = `
    SELECT c.*, 
      (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id AND b.status = 'completed') as visits_count
    FROM customers c
    WHERE c.tenant_id = $1
  `;
  const params = [];
  let paramCount = 2;

  if (search) {
    sql += ` AND (LOWER(c.name) LIKE LOWER($${paramCount}) OR c.phone LIKE $${paramCount})`;
    params.push(`%${search}%`);
    paramCount++;
  }
  
  // order and limit
  sql += ` ORDER BY c.last_seen DESC NULLS LAST, c.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const result = await tenantQuery(tenantId, pool, sql, params);

  // count total
  let countSql = `SELECT COUNT(*) FROM customers WHERE tenant_id = $1`;
  const countParams = [tenantId];
  if (search) {
    countSql += ` AND (LOWER(name) LIKE LOWER($2) OR phone LIKE $2)`;
    countParams.push(`%${search}%`);
  }
  const countRes = await pool.query(countSql, countParams);

  return {
    customers: result.rows,
    total: parseInt(countRes.rows[0].count)
  };
}

/**
 * Updates customer last seen timestamp
 * Called on every new message
 */
async function updateLastSeen(pool, tenantId, customerId) {
  const sql = `UPDATE customers SET last_seen = NOW() WHERE tenant_id = $1 AND id = $2`;
  await tenantQuery(tenantId, pool, sql, [customerId]);
}

/**
 * Gets customer visit history
 * Returns all past bookings with doctor names
 */
async function getCustomerHistory(pool, tenantId, customerId) {
  const sql = `
    SELECT b.*, cd.name AS doctor_name, cd.specialization
    FROM bookings b
    LEFT JOIN clinic_doctors cd ON cd.id = b.doctor_id
    WHERE b.tenant_id = $1 AND b.customer_id = $2
    ORDER BY b.booking_date DESC, b.token_number DESC
  `;
  const result = await tenantQuery(tenantId, pool, sql, [customerId]);
  return result.rows;
}

/**
 * Updates customer notes
 */
async function updateCustomerNotes(pool, tenantId, customerId, notes) {
  const sql = `UPDATE customers SET notes = $2 WHERE tenant_id = $1 AND id = $3 RETURNING *`;
  const result = await tenantQuery(tenantId, pool, sql, [notes, customerId]);
  return result.rows.length ? result.rows[0] : null;
}

/**
 * Updates customer record manually
 */
async function updateCustomer(pool, tenantId, customerId, data) {
  const { name, phone, email, dateOfBirth, notes } = data;
  const sql = `
    UPDATE customers 
    SET name = COALESCE($2, name),
        phone = COALESCE($3, phone),
        email = COALESCE($4, email),
        date_of_birth = COALESCE($5, date_of_birth),
        notes = COALESCE($6, notes)
    WHERE tenant_id = $1 AND id = $7
    RETURNING *
  `;
  const result = await tenantQuery(tenantId, pool, sql, [
    name || null,
    phone || null,
    email || null,
    dateOfBirth || null,
    notes || null,
    customerId
  ]);
  return result.rows.length ? result.rows[0] : null;
}

module.exports = {
  upsertCustomer,
  getCustomerByPhone,
  getCustomerById,
  getCustomers,
  updateLastSeen,
  getCustomerHistory,
  updateCustomerNotes,
  updateCustomer
};

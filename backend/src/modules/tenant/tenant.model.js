/**
 * Tenant Data Model
 * Uses plain pg module methods
 */

/**
 * Creates a new tenant record in the database
 * @param {object} pool - PostgreSQL pool
 * @param {object} tenantData - { name, slug, industry, plan, whatsapp_number }
 * @returns {Promise<object>} Created tenant record
 */
const createTenant = async (pool, tenantData) => {
  const { name, slug, industry, plan, whatsapp_number } = tenantData;
  const sql = `
    INSERT INTO tenants (name, slug, industry, plan, whatsapp_number, status)
    VALUES ($1, $2, $3, $4, $5, 'active')
    RETURNING *
  `;
  const result = await pool.query(sql, [name, slug, industry, plan, whatsapp_number]);
  return result.rows[0];
};

/**
 * Retrieves a tenant by their UUID
 * @param {object} pool - PostgreSQL pool
 * @param {string} id - Tenant UUID
 * @returns {Promise<object|null>} Tenant record or null
 */
const getTenantById = async (pool, id) => {
  const sql = `SELECT * FROM tenants WHERE id = $1`;
  const result = await pool.query(sql, [id]);
  return result.rows[0] || null;
};

/**
 * Retrieves a tenant by their unique slug
 * @param {object} pool - PostgreSQL pool
 * @param {string} slug - Tenant slug
 * @returns {Promise<object|null>} Tenant record or null
 */
const getTenantBySlug = async (pool, slug) => {
  const sql = `SELECT * FROM tenants WHERE slug = $1`;
  const result = await pool.query(sql, [slug]);
  return result.rows[0] || null;
};

/**
 * Retrieves a tenant by their WhatsApp number
 * @param {object} pool - PostgreSQL pool
 * @param {string} whatsappNumber - Normalized phone number
 * @returns {Promise<object|null>} Tenant record or null
 */
const getTenantByWhatsapp = async (pool, whatsappNumber) => {
  const sql = `SELECT * FROM tenants WHERE whatsapp_number = $1`;
  const result = await pool.query(sql, [whatsappNumber]);
  return result.rows[0] || null;
};

/**
 * Updates allowed tenant fields
 * @param {object} pool - PostgreSQL pool
 * @param {string} id - Tenant UUID
 * @param {object} updateData - Fields to update
 * @returns {Promise<object>} Updated tenant record
 */
const updateTenant = async (pool, id, updateData) => {
  const fields = Object.keys(updateData);
  if (fields.length === 0) return getTenantById(pool, id);

  const setClause = fields.map((field, i) => `${field} = $${i + 2}`).join(', ');
  const values = fields.map(field => updateData[field]);

  const sql = `
    UPDATE tenants
    SET ${setClause}, updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `;
  const result = await pool.query(sql, [id, ...values]);
  return result.rows[0];
};

/**
 * Sets or updates a single config value for a tenant
 * Uses PostgreSQL ON CONFLICT upsert
 * @param {object} pool - PostgreSQL pool
 * @param {string} tenantId - Tenant UUID
 * @param {string} key - Config key
 * @param {string} value - Config value
 * @returns {Promise<object>} Upserted config record
 */
const setTenantConfig = async (pool, tenantId, key, value) => {
  const sql = `
    INSERT INTO tenant_configs (tenant_id, key, value)
    VALUES ($1, $2, $3)
    ON CONFLICT (tenant_id, key)
    DO UPDATE SET value = $3
    RETURNING *
  `;
  const result = await pool.query(sql, [tenantId, key, value]);
  return result.rows[0];
};

/**
 * Retrieves all config values for a tenant
 * @param {object} pool - PostgreSQL pool
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<Array>} Array of config records
 */
const getTenantConfigs = async (pool, tenantId) => {
  const sql = `SELECT key, value FROM tenant_configs WHERE tenant_id = $1`;
  const result = await pool.query(sql, [tenantId]);
  return result.rows;
};

/**
 * Retrieves a single config value by key
 * @param {object} pool - PostgreSQL pool
 * @param {string} tenantId - Tenant UUID
 * @param {string} key - Config key
 * @returns {Promise<string|null>} Config value or null
 */
const getTenantConfigByKey = async (pool, tenantId, key) => {
  const sql = `SELECT value FROM tenant_configs WHERE tenant_id = $1 AND key = $2`;
  const result = await pool.query(sql, [tenantId, key]);
  return result.rows.length > 0 ? result.rows[0].value : null;
};

/**
 * Checks if a slug already exists
 * @param {object} pool - PostgreSQL pool
 * @param {string} slug - Slug to check
 * @returns {Promise<boolean>} True if exists
 */
const slugExists = async (pool, slug) => {
  const sql = `SELECT EXISTS(SELECT 1 FROM tenants WHERE slug = $1)`;
  const result = await pool.query(sql, [slug]);
  return result.rows[0].exists;
};

/**
 * Checks if a WhatsApp number is already registered
 * @param {object} pool - PostgreSQL pool
 * @param {string} number - Normalized number to check
 * @returns {Promise<boolean>} True if exists
 */
const whatsappNumberExists = async (pool, number) => {
  const sql = `SELECT EXISTS(SELECT 1 FROM tenants WHERE whatsapp_number = $1)`;
  const result = await pool.query(sql, [number]);
  return result.rows[0].exists;
};

module.exports = {
  createTenant,
  getTenantById,
  getTenantBySlug,
  getTenantByWhatsapp,
  updateTenant,
  setTenantConfig,
  getTenantConfigs,
  getTenantConfigByKey,
  slugExists,
  whatsappNumberExists
};

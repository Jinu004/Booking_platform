const pool = require('../config/database');
const logger = require('./logger');

async function logAction({ tenantId, staffId = null, action, entityType = null, entityId = null, metadata = null, ipAddress = null }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (tenant_id, staff_id, action, entity_type, entity_id, metadata, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, staffId, action, entityType, entityId, metadata ? JSON.stringify(metadata) : null, ipAddress]
    );
  } catch (err) {
    logger.warn('Audit log insert failed:', err.message);
  }
}

module.exports = { logAction };

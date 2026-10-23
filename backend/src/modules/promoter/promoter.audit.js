const pool = require('../../config/database');
const logger = require('../../utils/logger');

/**
 * Writes one promoter_audit_logs row. Pass the transaction client as `db` when inside a
 * transaction so the audit row commits or rolls back with the change it describes.
 * Inside a transaction a failure is thrown (the change must not happen without its audit row).
 */
async function logPromoterAudit(db, {
  actorType, actorId = null, action, promoterId = null, tenantId = null,
  entityType = null, entityId = null, before = null, after = null, reason = null, ip = null
}) {
  const sql = `INSERT INTO promoter_audit_logs
      (actor_type, actor_id, action, promoter_id, tenant_id, entity_type, entity_id, before, after, reason, ip_address)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`;
  const params = [actorType, actorId, action, promoterId, tenantId, entityType, entityId,
    before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after),
    reason, ip ? String(ip).slice(0, 45) : null];
  if (db && db !== pool) {
    await db.query(sql, params);
    return;
  }
  try {
    await pool.query(sql, params);
  } catch (err) {
    logger.warn(`Promoter audit insert failed: ${err.message}`);
  }
}

/** Actor fields from an authenticated staff request */
function staffActor(req) {
  return { actorType: 'staff', actorId: isUuid(req.staff?.id) ? req.staff.id : null, ip: req.ip };
}

function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

module.exports = { logPromoterAudit, staffActor, isUuid };

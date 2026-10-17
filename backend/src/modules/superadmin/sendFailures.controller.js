const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { successResponse, errorResponse } = require('../../utils/response');
const { labelForCode } = require('./sendFailureLabels');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The interval comes from this list, never from the request text
const RANGES = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' };
const MAX_ROWS = 50;

/**
 * GET /superadmin/tenants/:id/send-failures?range=24h|7d|30d (default 7d)
 * Read only: recorded failed WhatsApp sends of one tenant (the table holds no patient data)
 */
async function getTenantSendFailures(req, res) {
  try {
    const { id } = req.params;
    if (!UUID_PATTERN.test(String(id))) {
      return errorResponse(res, 'Invalid tenant id', 400);
    }
    const range = req.query.range === undefined ? '7d' : String(req.query.range);
    const interval = RANGES[range];
    if (!interval) {
      return errorResponse(res, 'range must be 24h, 7d or 30d', 400);
    }

    const [byCode, rows] = await Promise.all([
      pool.query(
        `SELECT meta_code AS code, COUNT(*)::int AS count
         FROM send_failures
         WHERE tenant_id = $1 AND created_at >= NOW() - $2::interval
         GROUP BY meta_code
         ORDER BY count DESC, meta_code`,
        [id, interval]
      ),
      pool.query(
        `SELECT created_at, ctx, template_name, meta_code, meta_subcode, http_status, error_message
         FROM send_failures
         WHERE tenant_id = $1 AND created_at >= NOW() - $2::interval
         ORDER BY created_at DESC
         LIMIT ${MAX_ROWS}`,
        [id, interval]
      )
    ]);

    const summaryByCode = byCode.rows.map(r => ({ code: r.code, label: labelForCode(r.code), count: r.count }));
    return successResponse(res, {
      range,
      summary: {
        total: summaryByCode.reduce((sum, r) => sum + r.count, 0),
        by_code: summaryByCode
      },
      rows: rows.rows.map(r => ({ ...r, label: labelForCode(r.meta_code) }))
    });
  } catch (err) {
    logger.error(`SuperAdmin send failures (tenant) failed: ${err.message}`);
    return errorResponse(res, 'Failed to load the send failures', 500);
  }
}

/**
 * GET /superadmin/send-failures/summary
 * Read only: failure count of the last 24 hours for every tenant that has at least one (one grouped query)
 */
async function getSendFailuresSummary(req, res) {
  try {
    const result = await pool.query(
      `SELECT tenant_id, COUNT(*)::int AS count
       FROM send_failures
       WHERE tenant_id IS NOT NULL AND created_at >= NOW() - INTERVAL '24 hours'
       GROUP BY tenant_id
       ORDER BY count DESC`
    );
    return successResponse(res, result.rows);
  } catch (err) {
    logger.error(`SuperAdmin send failures (summary) failed: ${err.message}`);
    return errorResponse(res, 'Failed to load the send failures summary', 500);
  }
}

module.exports = { getTenantSendFailures, getSendFailuresSummary };

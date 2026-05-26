const pool = require('../../config/database');
const { successResponse, errorResponse } = require('../../utils/response');
const logger = require('../../utils/logger');

/**
 * GET /api/v1/superadmin/platform-config
 * Returns all platform config rows as { key: value } object
 */
async function getConfig(req, res) {
  try {
    const result = await pool.query(
      'SELECT key, value, label, updated_at FROM platform_config ORDER BY key'
    );
    const config = {};
    for (const row of result.rows) {
      config[row.key] = { value: parseFloat(row.value), label: row.label, updated_at: row.updated_at };
    }
    return successResponse(res, config);
  } catch (err) {
    logger.error('getConfig failed:', err.message);
    return errorResponse(res, 'Failed to fetch platform config', 500);
  }
}

/**
 * PUT /api/v1/superadmin/platform-config
 * Body: { key, value }
 * Updates the matching row and bumps updated_at
 */
async function updateConfig(req, res) {
  try {
    const { key, value } = req.body;
    if (!key || value === undefined || value === null) {
      return errorResponse(res, 'key and value are required', 400);
    }
    const numValue = parseFloat(value);
    if (isNaN(numValue)) {
      return errorResponse(res, 'value must be a number', 400);
    }
    const result = await pool.query(
      `UPDATE platform_config
       SET value = $1, updated_at = NOW()
       WHERE key = $2
       RETURNING key, value, label, updated_at`,
      [numValue, key]
    );
    if (!result.rows.length) {
      return errorResponse(res, `Config key '${key}' not found`, 404);
    }
    logger.info(`Platform config updated: ${key} = ${numValue}`);
    return successResponse(res, result.rows[0]);
  } catch (err) {
    logger.error('updateConfig failed:', err.message);
    return errorResponse(res, 'Failed to update platform config', 500);
  }
}

module.exports = { getConfig, updateConfig };

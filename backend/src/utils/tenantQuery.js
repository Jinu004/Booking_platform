const { validate: isUUID } = require('uuid');
const env = require('../config/env');
const logger = require('./logger');

/**
 * Enforces tenant scoping on all database queries.
 * Every business data query MUST go through this helper.
 * Automatically prepends tenant_id as $1 parameter.
 *
 * @param {string} tenantId - UUID of the tenant
 * @param {object} pool - PostgreSQL pool instance
 * @param {string} sql - SQL query with $1 as tenant_id
 * @param {Array} params - Additional query parameters
 * @returns {Promise<object>} Query result
 */
const tenantQuery = async (tenantId, pool, sql, params = []) => {
  if (!tenantId) {
    throw new Error('Tenant ID is required for a tenant query');
  }

  if (!isUUID(tenantId)) {
    throw new Error('Tenant ID must be a valid UUID');
  }

  const queryParams = [tenantId, ...params];

  if (env.NODE_ENV === 'development') {
    logger.info(`Executing tenant query: ${sql} | Params: ${JSON.stringify(queryParams)}`);
  }

  return await pool.query(sql, queryParams);
};

module.exports = tenantQuery;

const tenantService = require('./tenant.service');
const { errorResponse } = require('../../utils/response');
const logger = require('../../utils/logger');

/**
 * Identifies tenant from incoming request
 * Supports dev bypass via x-dev-tenant-id header
 */
const identifyTenant = async (req, res, next) => {
  try {
    let tenant = null;

    // 1. Development bypass — x-dev-tenant-id header
    if (process.env.BYPASS_AUTH === 'true') {
      const devTenantId = req.headers['x-dev-tenant-id']
      if (devTenantId) {
        try {
          tenant = await tenantService
            .getTenantById(devTenantId)
        } catch (e) {
          logger.warn('Dev tenant lookup failed:', e.message)
        }
      }
    }

    // 2. WhatsApp number from webhook body
    if (!tenant && req.body && req.body.from) {
      tenant = await tenantService
        .getTenantByWhatsapp(req.body.from)
    }

    // 3. x-tenant-id header (production API calls)
    if (!tenant && req.headers['x-tenant-id']) {
      try {
        tenant = await tenantService
          .getTenantById(req.headers['x-tenant-id'])
      } catch (e) {
        logger.warn('Tenant header lookup failed:', e.message)
      }
    }

    // 4. tenant-id header (legacy support)
    if (!tenant && req.headers['tenant-id']) {
      try {
        tenant = await tenantService
          .getTenantById(req.headers['tenant-id'])
      } catch (e) {
        logger.warn('Tenant ID header lookup failed:', e.message)
      }
    }

    if (!tenant) {
      return errorResponse(
        res, 'Tenant could not be identified', 404
      )
    }

    if (tenant.status === 'inactive') {
      return errorResponse(
        res, 'Tenant account is inactive', 403
      )
    }

    if (tenant.status === 'suspended') {
      return errorResponse(
        res, 'Account suspended. Contact support.', 403
      )
    }

    req.tenant = tenant
    next()
  } catch (error) {
    logger.error(
      'Error in identifyTenant middleware:', error
    )
    return errorResponse(
      res,
      'Internal server error during tenant identification',
      500
    )
  }
}

module.exports = { identifyTenant }

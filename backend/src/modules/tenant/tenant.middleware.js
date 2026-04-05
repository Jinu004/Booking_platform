const tenantService = require('./tenant.service');
const { errorResponse } = require('../../utils/response');
const logger = require('../../utils/logger');

/**
 * Identifies tenant from incoming request
 * Used by all channel webhooks and API calls
 */
const identifyTenant = async (req, res, next) => {
  try {
    let tenant = null;

    // 1. WhatsApp number from body
    if (req.body && req.body.from) {
      tenant = await tenantService.getTenantByWhatsapp(req.body.from);
    }
    
    // 2. API Key header
    if (!tenant && req.headers['x-api-key']) {
      // Logic for api key would go here in Future when API keys are built
    }

    // 3. Tenant ID header
    if (!tenant && req.headers['tenant-id']) {
      try {
        tenant = await tenantService.getTenantById(req.headers['tenant-id']);
      } catch (e) {
        // fail gracefully if non-uuid or missing
      }
    }

    if (!tenant) {
      return errorResponse(res, 'Tenant could not be identified', 404);
    }

    if (tenant.status === 'inactive') {
      return errorResponse(res, 'Tenant account is inactive', 403);
    }

    if (tenant.status === 'suspended') {
      return errorResponse(res, 'Account suspended. Contact support.', 403);
    }

    req.tenant = tenant;
    next();
  } catch (error) {
    logger.error('Error in identifyTenant middleware:', error);
    return errorResponse(res, 'Internal server error during tenant identification', 500);
  }
};

module.exports = { identifyTenant };

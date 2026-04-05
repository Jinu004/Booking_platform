const tenantService = require('./tenant.service');
const { successResponse, errorResponse } = require('../../utils/response');

/**
 * POST / — Create new tenant
 */
const createTenant = async (req, res) => {
  try {
    const tenantData = req.body;
    const tenant = await tenantService.createTenant(tenantData);
    return successResponse(res, tenant, 200); 
  } catch (error) {
    if (error.message === 'WhatsApp number is already registered') {
      return errorResponse(res, error.message, 400);
    }
    return errorResponse(res, error.message, 500);
  }
};

/**
 * GET /:id — Get tenant by ID
 */
const getTenantById = async (req, res) => {
  try {
    const { id } = req.params;
    const tenant = await tenantService.getTenantById(id);
    return successResponse(res, tenant, 200);
  } catch (error) {
    return errorResponse(res, error.message, 404);
  }
};

/**
 * GET /slug/:slug — Get tenant by slug
 */
const getTenantBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const pool = require('../../config/database');
    const tenantModel = require('./tenant.model');
    const tenant = await tenantModel.getTenantBySlug(pool, slug);
    if (!tenant) throw new Error('Tenant not found');
    return successResponse(res, tenant, 200);
  } catch (error) {
    return errorResponse(res, error.message, 404);
  }
};

/**
 * PUT /:id — Update tenant
 */
const updateTenant = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const tenant = await tenantService.updateTenant(id, updateData);
    return successResponse(res, tenant, 200);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * POST /:id/config — Set single config value
 */
const setConfig = async (req, res) => {
  try {
    const { id } = req.params;
    const { key, value } = req.body;
    const config = await tenantService.setConfig(id, key, value);
    return successResponse(res, config, 200);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * GET /:id/config — Get all configs as flat object
 */
const getAllConfigs = async (req, res) => {
  try {
    const { id } = req.params;
    await tenantService.getTenantById(id); // Ensures validation exists
    const configs = await tenantService.getAllConfigs(id);
    return successResponse(res, configs, 200);
  } catch (error) {
    return errorResponse(res, error.message, 404);
  }
};

module.exports = {
  createTenant,
  getTenantById,
  getTenantBySlug,
  updateTenant,
  setConfig,
  getAllConfigs
};

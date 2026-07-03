const tenantService = require('./tenant.service');
const { successResponse, errorResponse } = require('../../utils/response');
const pool = require('../../config/database');
const tenantModel = require('./tenant.model');

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
    const tenant = await tenantModel.getTenantBySlug(pool, slug);
    if (!tenant) throw new Error('Tenant not found');
    return successResponse(res, tenant, 200);
  } catch (error) {
    return errorResponse(res, error.message, 404);
  }
};

/**
 * PUT /:id — Update tenant
 * Only super_admin may update a different tenant's record.
 */
const STAFF_ALLOWED_FIELDS = new Set(['name']);
const SUPER_ADMIN_ALLOWED_FIELDS = new Set(['name', 'slug', 'plan', 'status', 'industry', 'whatsapp_number']);

const updateTenant = async (req, res) => {
  try {
    const { id } = req.params;
    if (req.staff?.role !== 'super_admin' && id !== req.tenantId) {
      return errorResponse(res, 'Forbidden', 403);
    }
    const allowedFields = req.staff?.role === 'super_admin' ? SUPER_ADMIN_ALLOWED_FIELDS : STAFF_ALLOWED_FIELDS;
    const updateData = {};
    for (const key of Object.keys(req.body)) {
      if (allowedFields.has(key)) updateData[key] = req.body[key];
    }
    if (Object.keys(updateData).length === 0) {
      return errorResponse(res, 'No valid fields to update', 400);
    }
    const tenant = await tenantService.updateTenant(id, updateData);
    return successResponse(res, tenant, 200);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * POST /:id/config — Set single config value
 * Only super_admin may write config for a different tenant.
 */
const RESERVED_CONFIG_KEYS = new Set([
  'proactive_templates_enabled',
  'plan_override',
  'quota_override'
]);

const setConfig = async (req, res) => {
  try {
    const { id } = req.params;
    if (req.staff?.role !== 'super_admin' && id !== req.tenantId) {
      return errorResponse(res, 'Forbidden', 403);
    }
    const { key, value } = req.body;
    if (req.staff?.role !== 'super_admin' && RESERVED_CONFIG_KEYS.has(key)) {
      return errorResponse(res, 'Forbidden — this config key can only be set by a super admin', 403);
    }
    const config = await tenantService.setConfig(id, key, value);
    return successResponse(res, config, 200);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * GET /:id/config — Get all configs as flat object
 * Only super_admin may read config for a different tenant.
 */
const getAllConfigs = async (req, res) => {
  try {
    const { id } = req.params;
    if (req.staff?.role !== 'super_admin' && id !== req.tenantId) {
      return errorResponse(res, 'Forbidden', 403);
    }
    await tenantService.getTenantById(id); // Ensures tenant exists
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

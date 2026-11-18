const tenantService = require('./tenant.service');
const { successResponse, errorResponse } = require('../../utils/response');
const pool = require('../../config/database');
const tenantModel = require('./tenant.model');
const logger = require('../../utils/logger');

// Unexpected errors: the real message stays in the server log, the client gets a fixed text
const GENERIC_ERROR = 'Something went wrong. Please try again.';

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
    logger.error('Error creating tenant:', error.message);
    return errorResponse(res, GENERIC_ERROR, 500);
  }
};

/**
 * GET /:id — Get tenant by ID
 */
const getTenantById = async (req, res) => {
  try {
    const { id } = req.params;
    if (req.staff?.role !== 'super_admin' && id !== req.tenantId) {
      return errorResponse(res, 'Forbidden', 403);
    }
    const tenant = await tenantService.getTenantById(id);
    return successResponse(res, tenant, 200);
  } catch (error) {
    if (error.message !== 'Tenant not found') logger.error('Error fetching tenant by id:', error.message);
    return errorResponse(res, 'Not found', 404);
  }
};

/**
 * GET /slug/:slug — Get tenant by slug
 */
const getTenantBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const tenant = await tenantModel.getTenantBySlug(pool, slug);
    if (!tenant) return errorResponse(res, 'Not found', 404);
    // Another clinic's slug answers exactly like a missing one, so a clinic user cannot learn which slugs exist
    if (req.staff?.role !== 'super_admin' && tenant.id !== req.tenantId) {
      return errorResponse(res, 'Not found', 404);
    }
    return successResponse(res, tenant, 200);
  } catch (error) {
    logger.error('Error fetching tenant by slug:', error.message);
    return errorResponse(res, 'Not found', 404);
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
    if (error.status === 409) return errorResponse(res, error.message, 409);
    if (error.code === '23505' && error.constraint === 'tenants_whatsapp_number_key') {
      return errorResponse(res, 'This WhatsApp number is already used by another clinic', 409);
    }
    logger.error('Error updating tenant:', error.message);
    return errorResponse(res, GENERIC_ERROR, 500);
  }
};

/**
 * POST /:id/config — Set single config value
 * Only super_admin may write config for a different tenant.
 */
// Allow-list for clinic users (admin, manager): the same keys a clinic may save on the Settings screen (PUT /settings,
// ALLOWED_SETTINGS_KEYS in settings.controller.js) without booking_mode, which only a super admin changes. Any other key
// (feature flags, quotas, wa_* state, AI flags) is refused. A super admin may still write any key.
const CLINIC_CONFIG_KEYS = new Set([
  'language',
  'ai_personality', 'ai_language', 'ai_greeting', 'ai_name', 'ai_tone',
  'ai_escalation_message', 'ai_response_delay',
  'escalation_threshold', 'escalation_timeout',
  'booking_advance_days', 'booking_confirmation_msg', 'booking_cancel_msg',
  'booking_same_day', 'token_prefix', 'token_format',
  'weekly_off', 'avg_consultation_minutes', 'reset_time', 'max_tokens_per_day',
  'opening_time', 'closing_time',
  'notification_reminder_hours', 'reminder_enabled', 'notification_channel'
]);

const setConfig = async (req, res) => {
  try {
    const { id } = req.params;
    if (req.staff?.role !== 'super_admin' && id !== req.tenantId) {
      return errorResponse(res, 'Forbidden', 403);
    }
    const { key, value } = req.body;
    if (req.staff?.role !== 'super_admin' && !CLINIC_CONFIG_KEYS.has(key)) {
      return errorResponse(res, 'Forbidden — this config key can only be set by a super admin', 403);
    }
    const config = await tenantService.setConfig(id, key, value);
    return successResponse(res, config, 200);
  } catch (error) {
    logger.error('Error setting tenant config:', error.message);
    return errorResponse(res, GENERIC_ERROR, 500);
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
    if (req.staff?.role === 'super_admin') return successResponse(res, configs, 200);
    // Internal connection and reminder keys (wa_*) and the guided knowledge base switch are for super admins only
    const visible = Object.fromEntries(Object.entries(configs).filter(([key]) => !key.startsWith('wa_') && key !== 'ai_guided_kb' && key !== 'ai_info_changed_at' && key !== 'typing_indicator'));
    return successResponse(res, visible, 200);
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

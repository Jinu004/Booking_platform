const express = require('express');
const logger = require('../../utils/logger');
const tenantService = require('../tenant/tenant.service');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const {
  getAllTenants,
  getTenantDetails,
  updateTenantStatus,
  updateTenant,
  syncWhatsappNumber,
  createTenant,
  getPlatformStats,
  clearTenantConversations,
  deleteTenant,
  getPosterRequests,
  approvePosterRequest,
  rejectPosterRequest
} = require('./superadmin.controller');
const { getConfig, updateConfig } = require('./platform-config.controller');
const { getTenantSendFailures, getSendFailuresSummary } = require('./sendFailures.controller');
const { fetchWabaInfo } = require('../waba/waba.info.service');
const { getSendReadiness } = require('../campaign/campaign.readiness');
const { getPosterImageAsSuperAdmin } = require('../tenant/poster.controller');
const { successResponse, errorResponse } = require('../../utils/response');
const { createTemplatesForTenant, refreshTemplateStatuses, getTenantTemplates, createPosterTemplate, TemplateError } = require('../waba/waba.templates.service');

const router = express.Router();

router.use(requireAuth);
router.use(requireRole('super_admin'));

router.get('/tenants', getAllTenants);
router.post('/tenants', createTenant);
router.get('/tenants/:id', getTenantDetails);
router.patch('/tenants/:id/status', updateTenantStatus);
router.patch('/tenants/:id/config', async (req, res) => {
  try {
    const { key, value } = req.body
    if (!key) return res.status(400).json({ error: 'key is required' })
    await tenantService.setConfig(req.params.id, key, String(value))
    return res.json({ success: true, key, value })
  } catch (err) {
    logger.error('SuperAdmin config update failed:', err.message)
    return res.status(500).json({ error: 'Failed to update config' })
  }
})
// WhatsApp templates on the clinic's own WhatsApp Business account
const templateRoute = (action) => async (req, res) => {
  try {
    const data = await action(req.params.id);
    return successResponse(res, data);
  } catch (err) {
    if (err instanceof TemplateError) return errorResponse(res, err.message, err.status);
    logger.error(`SuperAdmin templates failed: ${err.message}`);
    return errorResponse(res, 'Template request failed', 500);
  }
};
router.post('/tenants/:id/templates/create', templateRoute(createTemplatesForTenant));
router.post('/tenants/:id/templates/refresh', templateRoute(refreshTemplateStatuses));
router.get('/tenants/:id/templates', templateRoute(getTenantTemplates));
// One reusable poster template (image header) per clinic, from an approved poster request
router.post('/tenants/:id/poster-template', async (req, res) => {
  try {
    const result = await createPosterTemplate(req.params.id, req.body?.poster_request_id);
    return successResponse(res, { ok: true, status: result.status, template: result.template });
  } catch (err) {
    if (err instanceof TemplateError) return errorResponse(res, err.message, err.status);
    logger.error(`SuperAdmin poster template failed: ${err.message}`);
    return errorResponse(res, 'Poster template request failed', 500);
  }
});

// WhatsApp account information fetched from Meta (read only: GET requests only)
router.get('/tenants/:id/waba-info', templateRoute(fetchWabaInfo));

// Pre-send readiness for a poster campaign (read only, always a fresh check)
router.get('/tenants/:id/send-readiness', templateRoute((tenantId) => getSendReadiness(tenantId, { fresh: true })));

// Failed WhatsApp sends (read only)
router.get('/tenants/:id/send-failures', getTenantSendFailures);
router.get('/send-failures/summary', getSendFailuresSummary);

router.patch('/tenants/:id', updateTenant);
router.post('/tenants/:id/sync-whatsapp-number', syncWhatsappNumber);
router.delete('/tenants/:id', deleteTenant);
router.get('/stats', getPlatformStats);
router.delete('/tenants/:id/conversations', clearTenantConversations);

router.get('/platform-config', getConfig);
router.put('/platform-config', updateConfig);

router.get('/poster-requests', getPosterRequests);
router.get('/poster-requests/:id/image', getPosterImageAsSuperAdmin);
router.patch('/poster-requests/:id/approve', approvePosterRequest);
router.patch('/poster-requests/:id/reject', rejectPosterRequest);

module.exports = router;

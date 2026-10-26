// Super admin endpoints of the recorded clinic offboarding (see offboarding.service.js). The routes sit under the super_admin guard.
const { successResponse, errorResponse } = require('../../utils/response');
const logger = require('../../utils/logger');
const { getOffboardingService, OffboardingError } = require('./offboarding.service');

function fail(res, err, label) {
  if (err instanceof OffboardingError) return errorResponse(res, err.message, err.statusCode);
  logger.error(`${label} failed: ${String((err && err.message) || err).slice(0, 300)}`);
  return errorResponse(res, 'The request failed', 500);
}

// POST /superadmin/tenants/:id/deletion-request   body { notes? }   (the clinic must be suspended; starts the 30-day clock)
async function createDeletionRequest(req, res) {
  try {
    const request = await getOffboardingService().createDeletionRequest(req.params.id, req.staff && req.staff.id, req.body && req.body.notes);
    return successResponse(res, request, 201);
  } catch (err) {
    return fail(res, err, 'Deletion request');
  }
}

// GET /superadmin/deletion-requests   (all requests with days_left of the 30)
async function listDeletionRequests(req, res) {
  try {
    return successResponse(res, await getOffboardingService().listDeletionRequests());
  } catch (err) {
    return fail(res, err, 'Deletion request list');
  }
}

// GET /superadmin/tenants/:id/deletion-preview   (read only: counts of what a full delete would remove)
async function previewDeletion(req, res) {
  try {
    return successResponse(res, await getOffboardingService().previewDeletion(req.params.id));
  } catch (err) {
    return fail(res, err, 'Deletion preview');
  }
}

// POST /superadmin/tenants/:id/full-delete   body { confirmName }   (the clinic name, typed exactly)
async function fullDelete(req, res) {
  try {
    const result = await getOffboardingService().fullDelete(req.params.id, {
      confirmName: req.body && req.body.confirmName,
      requestedBy: req.staff && req.staff.id
    });
    return successResponse(res, result);
  } catch (err) {
    return fail(res, err, 'Full delete');
  }
}

module.exports = { createDeletionRequest, listDeletionRequests, previewDeletion, fullDelete };

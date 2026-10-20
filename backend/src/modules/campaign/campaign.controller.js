const { successResponse, errorResponse } = require('../../utils/response')
const logger = require('../../utils/logger')
const service = require('./campaign.service')

// Same tenant check as the poster upload: staff may only act on their own clinic
function tenantMismatch(req, res) {
  const { id: tenantId } = req.params
  if (req.staff.role !== 'super_admin' && req.staff.tenantId !== tenantId) {
    errorResponse(res, 'Forbidden: tenant mismatch', 403)
    return true
  }
  return false
}

function handleError(res, err, what) {
  if (err instanceof service.CampaignError) {
    // Some errors carry extra fields (for example { preview } for preview_changed, { reasons } for a not-ready clinic)
    if (err.extra) return res.status(err.status).json({ success: false, data: null, error: err.message, ...err.extra })
    return errorResponse(res, err.message, err.status)
  }
  logger.error(`Campaign ${what} failed: ${err.message}`)
  return errorResponse(res, `Failed to ${what}`, 500)
}

async function createCampaign(req, res) {
  if (tenantMismatch(req, res)) return
  try {
    const result = await service.createDraftCampaign(req.params.id, req.body?.poster_request_id)
    return successResponse(res, result, 201)
  } catch (err) {
    return handleError(res, err, 'create the campaign')
  }
}

async function listCampaigns(req, res) {
  if (tenantMismatch(req, res)) return
  try {
    return successResponse(res, await service.getCampaigns(req.params.id))
  } catch (err) {
    return handleError(res, err, 'load campaigns')
  }
}

async function getCampaign(req, res) {
  if (tenantMismatch(req, res)) return
  try {
    return successResponse(res, await service.getCampaign(req.params.id, req.params.campaignId))
  } catch (err) {
    return handleError(res, err, 'load the campaign')
  }
}

async function cancelCampaign(req, res) {
  if (tenantMismatch(req, res)) return
  try {
    return successResponse(res, await service.cancelCampaign(req.params.id, req.params.campaignId))
  } catch (err) {
    return handleError(res, err, 'cancel the campaign')
  }
}

async function previewCampaign(req, res) {
  if (tenantMismatch(req, res)) return
  try {
    return successResponse(res, await service.previewCampaign(req.params.id, req.params.campaignId))
  } catch (err) {
    return handleError(res, err, 'load the campaign preview')
  }
}

async function confirmCampaign(req, res) {
  if (tenantMismatch(req, res)) return
  try {
    const result = await service.confirmCampaign(
      req.params.id,
      req.params.campaignId,
      req.staff?.id || null,
      req.body?.expected_to_send
    )
    return successResponse(res, result)
  } catch (err) {
    return handleError(res, err, 'confirm the campaign')
  }
}

module.exports = { createCampaign, listCampaigns, getCampaign, cancelCampaign, previewCampaign, confirmCampaign }

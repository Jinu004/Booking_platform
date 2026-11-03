const express = require('express')
const { requireAuth, requireRole } = require('../auth/auth.middleware')
const { createCampaign, listCampaigns, getCampaign, cancelCampaign, previewCampaign, confirmCampaign } = require('./campaign.controller')
const { requirePostersPlan } = require('../../config/plans')

// Mounted under /api/v1/tenants. Same auth and role as the poster upload (admin or manager of the clinic).
const router = express.Router()

router.use(requireAuth)

// Campaigns are for the Growth and Pro plans (requirePostersPlan)
router.post('/:id/campaigns', requireRole('admin', 'manager'), requirePostersPlan, createCampaign)
router.get('/:id/campaigns', requireRole('admin', 'manager'), requirePostersPlan, listCampaigns)
router.get('/:id/campaigns/:campaignId', requireRole('admin', 'manager'), requirePostersPlan, getCampaign)
router.get('/:id/campaigns/:campaignId/preview', requireRole('admin', 'manager'), requirePostersPlan, previewCampaign)
router.post('/:id/campaigns/:campaignId/confirm', requireRole('admin', 'manager'), requirePostersPlan, confirmCampaign)
router.post('/:id/campaigns/:campaignId/cancel', requireRole('admin', 'manager'), requirePostersPlan, cancelCampaign)

module.exports = router

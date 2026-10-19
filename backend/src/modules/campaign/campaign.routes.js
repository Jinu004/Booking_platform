const express = require('express')
const { requireAuth, requireRole } = require('../auth/auth.middleware')
const { createCampaign, listCampaigns, getCampaign, cancelCampaign } = require('./campaign.controller')

// Mounted under /api/v1/tenants. Same auth and role as the poster upload (admin or manager of the clinic).
const router = express.Router()

router.use(requireAuth)

router.post('/:id/campaigns', requireRole('admin', 'manager'), createCampaign)
router.get('/:id/campaigns', requireRole('admin', 'manager'), listCampaigns)
router.get('/:id/campaigns/:campaignId', requireRole('admin', 'manager'), getCampaign)
router.post('/:id/campaigns/:campaignId/cancel', requireRole('admin', 'manager'), cancelCampaign)

module.exports = router

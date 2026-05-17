const express = require('express')
const { requireAuth, requireRole } = require('../auth/auth.middleware')
const {
  getSettings,
  updateSettings,
  getClinicSettings,
  updateClinicSettings,
  getHITLSettings,
  updateHITLSettings
} = require('./settings.controller')

const router = express.Router()
router.use(requireAuth)

router.get('/', getSettings)
router.put('/', requireRole('admin', 'manager'), updateSettings)
router.get('/clinic', getClinicSettings)
router.put('/clinic', requireRole('admin', 'manager'), updateClinicSettings)
router.get('/hitl', getHITLSettings)
router.put('/hitl', requireRole('admin', 'manager'), updateHITLSettings)

module.exports = router

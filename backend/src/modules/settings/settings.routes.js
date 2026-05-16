const express = require('express')
const { requireAuth } = require('../auth/auth.middleware')
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
router.put('/', updateSettings)
router.get('/clinic', getClinicSettings)
router.put('/clinic', updateClinicSettings)
router.get('/hitl', getHITLSettings)
router.put('/hitl', updateHITLSettings)

module.exports = router

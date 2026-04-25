const express = require('express')
const { requireAuth } = require('../auth/auth.middleware')
const { ROLES } = require('../auth/auth.permissions')
const {
  getSettings,
  updateSettings,
  getClinicSettings,
  updateClinicSettings
} = require('./settings.controller')

const router = express.Router()

router.use(requireAuth)
router.use(requireAuth)

router.get('/', getSettings)
router.put('/', requireAuth, updateSettings)
router.get('/clinic', getClinicSettings)
router.put('/clinic', requireAuth, updateClinicSettings)

module.exports = router

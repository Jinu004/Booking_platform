const express = require('express')
const { requireAuth, loadTenant, requireRole } = require('../auth/auth.middleware')
const { ROLES } = require('../auth/auth.permissions')
const {
  getSettings,
  updateSettings,
  getClinicSettings,
  updateClinicSettings
} = require('./settings.controller')

const router = express.Router()

router.use(requireAuth)
router.use(loadTenant)

router.get('/', getSettings)
router.put('/', requireRole(ROLES.ADMIN, ROLES.MANAGER), updateSettings)
router.get('/clinic', getClinicSettings)
router.put('/clinic', requireRole(ROLES.ADMIN, ROLES.MANAGER), updateClinicSettings)

module.exports = router

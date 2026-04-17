const express = require('express')
const { requireAuth, loadTenant, requireRole } = require('../auth/auth.middleware')
const { ROLES } = require('../auth/auth.permissions')
const {
  getStaff,
  getStaffById,
  inviteStaff,
  updateStaff,
  deleteStaff
} = require('./staff.controller')

const router = express.Router()

// All paths require auth
router.use(requireAuth)
router.use(loadTenant)

router.get('/', getStaff)
router.get('/:id', getStaffById)
router.post('/', requireRole(ROLES.ADMIN, ROLES.MANAGER), inviteStaff)
router.patch('/:id', requireRole(ROLES.ADMIN), updateStaff)
router.delete('/:id', requireRole(ROLES.ADMIN), deleteStaff)

module.exports = router

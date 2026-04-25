const express = require('express')
const { requireAuth } = require('../auth/auth.middleware')
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

router.get('/', getStaff)
router.get('/:id', getStaffById)
router.post('/', requireAuth, inviteStaff)
router.patch('/:id', requireAuth, updateStaff)
router.delete('/:id', requireAuth, deleteStaff)

module.exports = router

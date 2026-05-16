const express = require('express')
const { requireAuth, requireRole } = require('../auth/auth.middleware')
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
router.post('/', requireRole('admin', 'manager'), inviteStaff)
router.patch('/:id', requireRole('admin', 'manager'), updateStaff)
router.delete('/:id', requireRole('admin'), deleteStaff)

module.exports = router

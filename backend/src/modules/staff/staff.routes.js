const express = require('express')
const { requireAuth, requireRole } = require('../auth/auth.middleware')
const {
  getStaff,
  getStaffById,
  inviteStaff,
  updateStaff,
  deleteStaff,
  activateStaff,
  deleteStaffPermanent
} = require('./staff.controller')

const router = express.Router()

// All paths require auth
router.use(requireAuth)

// Only the Staff screen (admin and manager link) calls these two reads
router.get('/', requireRole('admin', 'manager', 'super_admin'), getStaff)
router.get('/:id', requireRole('admin', 'manager', 'super_admin'), getStaffById)
router.post('/', requireRole('admin', 'manager'), inviteStaff)
router.patch('/:id', requireRole('admin', 'manager'), updateStaff)
router.patch('/:id/activate', requireRole('admin', 'manager'), activateStaff)
router.delete('/:id', requireRole('admin'), deleteStaff)
router.delete('/:id/permanent', requireRole('admin'), deleteStaffPermanent)

module.exports = router

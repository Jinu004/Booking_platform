const express = require('express')
const { requireAuth, requireRole } = require('../auth/auth.middleware')
const {
  getOverview,
  getDailyBookings,
  getDoctorStats,
  getPatientStats,
  getConversationStats
} = require('./analytics.controller')

const router = express.Router()

// All paths require auth and admin/manager roles
router.use(requireAuth)
router.use(requireRole('admin', 'manager'))

router.get('/overview', getOverview)
router.get('/bookings/daily', getDailyBookings)
router.get('/doctors', getDoctorStats)
router.get('/patients', getPatientStats)
router.get('/conversations', getConversationStats)

module.exports = router

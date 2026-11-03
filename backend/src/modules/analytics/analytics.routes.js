const express = require('express')
const { requireAuth, requireRole } = require('../auth/auth.middleware')
const { requireDoctorLink } = require('../../utils/doctorScope')
const {
  getOverview,
  getDailyBookings,
  getDoctorStats,
  getPatientStats,
  getConversationStats,
  getEnquiryOverview,
  getEnquiryDailyLeads,
  getTopProducts
} = require("./analytics.controller")

const router = express.Router()

// All paths require auth and admin/manager roles
router.use(requireAuth)
router.use(requireRole('admin', 'manager', 'doctor', 'super_admin'))
// A doctor with no doctor link is refused on every analytics handler (they used to fall through to clinic-wide data)
router.use(requireDoctorLink)

router.get('/overview', getOverview)
router.get('/bookings/daily', getDailyBookings)
router.get('/doctors', getDoctorStats)
router.get('/patients', getPatientStats)
router.get('/conversations', getConversationStats)

router.get("/enquiry/overview", getEnquiryOverview)
router.get("/enquiry/daily-leads", getEnquiryDailyLeads)
router.get("/enquiry/top-products", getTopProducts)

module.exports = router

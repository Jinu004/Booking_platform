const AnalyticsService = require('./analytics.service')
const { successResponse } = require('../../utils/response')

/**
 * GET /analytics/overview
 */
async function getOverview(req, res, next) {
  try {
    const { period = 'month' } = req.query
    const doctorId = req.staff.role === 'doctor' && req.staff.doctor_id ? req.staff.doctor_id : null
    const stats = await AnalyticsService.getOverviewStats(req.tenantId, period, doctorId)
    return successResponse(res, stats)
  } catch (err) {
    next(err)
  }
}

/**
 * GET /analytics/bookings/daily
 */
async function getDailyBookings(req, res, next) {
  try {
    const { period = 'month' } = req.query
    const doctorId = req.staff.role === 'doctor' && req.staff.doctor_id ? req.staff.doctor_id : null
    const data = await AnalyticsService.getDailyBookings(req.tenantId, period, doctorId)
    return successResponse(res, data)
  } catch (err) {
    next(err)
  }
}

/**
 * GET /analytics/doctors
 */
async function getDoctorStats(req, res, next) {
  try {
    const { period = 'month' } = req.query
    const doctorId = req.staff.role === 'doctor' && req.staff.doctor_id ? req.staff.doctor_id : null
    const data = await AnalyticsService.getDoctorStats(req.tenantId, period, doctorId)
    return successResponse(res, data)
  } catch (err) {
    next(err)
  }
}

/**
 * GET /analytics/patients
 */
async function getPatientStats(req, res, next) {
  try {
    const { period = 'month' } = req.query
    const data = await AnalyticsService.getPatientStats(req.tenantId, period)
    return successResponse(res, data)
  } catch (err) {
    next(err)
  }
}

/**
 * GET /analytics/conversations
 */
async function getConversationStats(req, res, next) {
  try {
    const { period = 'month' } = req.query
    const data = await AnalyticsService.getConversationStats(req.tenantId, period)
    return successResponse(res, data)
  } catch (err) {
    next(err)
  }
}

/**
 * GET /analytics/enquiry/overview
 */
async function getEnquiryOverview(req, res, next) {
  try {
    const { period = 'month' } = req.query
    const data = await AnalyticsService.getEnquiryOverview(req.tenantId, period)
    return successResponse(res, data)
  } catch (err) {
    next(err)
  }
}

/**
 * GET /analytics/enquiry/daily-leads
 */
async function getEnquiryDailyLeads(req, res, next) {
  try {
    const { period = 'month' } = req.query
    const data = await AnalyticsService.getEnquiryDailyLeads(req.tenantId, period)
    return successResponse(res, data)
  } catch (err) {
    next(err)
  }
}

/**
 * GET /analytics/enquiry/top-products
 */
async function getTopProducts(req, res, next) {
  try {
    const { period = 'month' } = req.query
    const data = await AnalyticsService.getTopProducts(req.tenantId, period)
    return successResponse(res, data)
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getOverview,
  getDailyBookings,
  getDoctorStats,
  getPatientStats,
  getConversationStats,
  getEnquiryOverview,
  getEnquiryDailyLeads,
  getTopProducts
}

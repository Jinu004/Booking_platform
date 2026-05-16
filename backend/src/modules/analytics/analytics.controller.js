const AnalyticsService = require('./analytics.service')
const { successResponse } = require('../../utils/response')

/**
 * GET /analytics/overview
 */
async function getOverview(req, res, next) {
  try {
    const { period = 'month' } = req.query
    const stats = await AnalyticsService.getOverviewStats(req.tenantId, period)
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
    const data = await AnalyticsService.getDailyBookings(req.tenantId, period)
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
    const data = await AnalyticsService.getDoctorStats(req.tenantId, period)
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

module.exports = {
  getOverview,
  getDailyBookings,
  getDoctorStats,
  getPatientStats,
  getConversationStats
}

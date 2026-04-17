const AnalyticsService = require('./analytics.service')
const { successResponse, errorResponse } = require('../../utils/response')
const logger = require('../../utils/logger')

/**
 * GET /analytics/overview
 */
async function getOverview(req, res) {
  try {
    const { period = 'month' } = req.query
    const stats = await AnalyticsService.getOverviewStats(req.tenantId, period)
    return successResponse(res, stats)
  } catch (err) {
    logger.error('Failed to get overview stats:', err.message)
    return errorResponse(res, 'Failed to fetch overview analytics', 500)
  }
}

/**
 * GET /analytics/bookings/daily
 */
async function getDailyBookings(req, res) {
  try {
    const data = await AnalyticsService.getDailyBookings(req.tenantId)
    return successResponse(res, data)
  } catch (err) {
    logger.error('Failed to get daily bookings:', err.message)
    return errorResponse(res, 'Failed to fetch daily bookings', 500)
  }
}

/**
 * GET /analytics/doctors
 */
async function getDoctorStats(req, res) {
  try {
    const data = await AnalyticsService.getDoctorStats(req.tenantId)
    return successResponse(res, data)
  } catch (err) {
    logger.error('Failed to get doctor stats:', err.message)
    return errorResponse(res, 'Failed to fetch doctor stats', 500)
  }
}

/**
 * GET /analytics/patients
 */
async function getPatientStats(req, res) {
  try {
    const { period = 'month' } = req.query
    const data = await AnalyticsService.getPatientStats(req.tenantId, period)
    return successResponse(res, data)
  } catch (err) {
    logger.error('Failed to get patient stats:', err.message)
    return errorResponse(res, 'Failed to fetch patient stats', 500)
  }
}

/**
 * GET /analytics/conversations
 */
async function getConversationStats(req, res) {
  try {
    const { period = 'month' } = req.query
    const data = await AnalyticsService.getConversationStats(req.tenantId, period)
    return successResponse(res, data)
  } catch (err) {
    logger.error('Failed to get conversation stats:', err.message)
    return errorResponse(res, 'Failed to fetch conversation stats', 500)
  }
}

module.exports = {
  getOverview,
  getDailyBookings,
  getDoctorStats,
  getPatientStats,
  getConversationStats
}

const BookingService = require('./booking.service');
const BookingModel = require('./booking.model');
const { successResponse, errorResponse } = require('../../utils/response');
const pool = require('../../config/database');

/**
 * GET /bookings
 * Gets bookings list with filters
 * Query params: date, status, doctorId, page, limit
 */
async function getBookings(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { date, status, doctorId, customerId, page, limit } = req.query;
    
    const result = await BookingService.getBookingsDashboard(tenantId, {
      date, status, doctorId, customerId, page, limit
    });
    
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /bookings/stats
 * Gets today's booking statistics
 */
async function getBookingStats(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const stats = await BookingService.getBookingStats(tenantId);
    return successResponse(res, stats);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /bookings/:id
 * Gets single booking with full details
 */
async function getBookingById(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    
    const booking = await BookingModel.getBookingById(pool, tenantId, id);
    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }
    
    return successResponse(res, booking);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /bookings
 * Creates new booking (staff portal)
 */
async function createBooking(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const result = await BookingService.createBookingWithToken(tenantId, req.body);
    return successResponse(res, result, 201);
  } catch (error) {
    if (error.message.includes('not available') || error.message.includes('fully booked')) {
      return errorResponse(res, error.message, 400);
    }
    next(error);
  }
}

/**
 * PATCH /bookings/:id/status
 * Updates booking status
 */
async function updateBookingStatus(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    const { status } = req.body;
    
    const booking = await BookingModel.updateBookingStatus(pool, tenantId, id, status);
    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }
    
    return successResponse(res, booking);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /bookings/:id/cancel
 * Cancels a booking
 */
async function cancelBooking(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    
    const booking = await BookingService.cancelBookingWithRules(tenantId, id, 'staff');
    return successResponse(res, booking);
  } catch (error) {
    if (error.message.includes('Cannot cancel')) {
      return errorResponse(res, error.message, 400);
    }
    next(error);
  }
}

/**
 * POST /bookings/:id/complete
 * Marks booking as completed
 */
async function completeBooking(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    
    const booking = await BookingService.completeBooking(tenantId, id);
    return successResponse(res, booking);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /bookings/:id/noshow
 * Marks patient as no show
 */
async function markNoShow(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    
    const booking = await BookingService.markNoShow(tenantId, id);
    return successResponse(res, booking);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getBookings,
  getBookingStats,
  getBookingById,
  createBooking,
  updateBookingStatus,
  cancelBooking,
  completeBooking,
  markNoShow
};

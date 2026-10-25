const express = require('express');
const { validationResult } = require('express-validator');
const { validationErrorResponse } = require('../../utils/response');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const {
  patientLookup,
  getBookings,
  getBookingStats,
  getBookingById,
  updateBookingStatus,
  updateAppointmentQueueStatus,
  cancelBooking,
  completeBooking,
  markNoShow,
  getTodayBookings,
  exportBookings,
  createManualBooking
} = require('./booking.controller');
const {
  validateUpdateStatus,
  validateQueueStatus
} = require('./booking.validation');

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return validationErrorResponse(res, errors.array());
  }
  next();
};

// All routes require tenant auth
router.use(requireAuth);

router.get('/lookup', patientLookup);
router.get('/', getBookings);
router.get('/today', getTodayBookings);
router.get('/export', requireRole('admin', 'manager'), exportBookings);
router.get('/stats', getBookingStats);
router.get('/:id', getBookingById);
router.post('/manual', createManualBooking);
router.patch('/:id/status', validateUpdateStatus, validate, updateBookingStatus);
router.patch('/:id/queue-status', validateQueueStatus, validate, updateAppointmentQueueStatus);
router.post('/:id/cancel', cancelBooking);
router.post('/:id/complete', completeBooking);
router.post('/:id/noshow', markNoShow);

module.exports = router;

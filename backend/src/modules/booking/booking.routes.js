const express = require('express');
const { validationErrorResponse } = require('../../utils/response');
const { requireAuth, loadTenant } = require('../auth/auth.middleware');
const {
  getBookings,
  getBookingStats,
  getBookingById,
  createBooking,
  updateBookingStatus,
  cancelBooking,
  completeBooking,
  markNoShow
} = require('./booking.controller');
const {
  validateCreateBooking,
  validateUpdateStatus
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
router.use(loadTenant);

router.get('/', getBookings);
router.get('/stats', getBookingStats);
router.get('/:id', getBookingById);
router.post('/', validateCreateBooking, validate, createBooking);
router.patch('/:id/status', validateUpdateStatus, validate, updateBookingStatus);
router.post('/:id/cancel', cancelBooking);
router.post('/:id/complete', completeBooking);
router.post('/:id/noshow', markNoShow);

module.exports = router;

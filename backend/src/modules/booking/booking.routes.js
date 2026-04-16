const express = require('express');
const { validationResult } = require('express-validator');
const { validationErrorResponse } = require('../../utils/response');
// For BYPASS_AUTH pattern, we might be using tenant.middleware or auth middleware. Let's assume tenant.middleware provides req.tenant.
const { identifyTenant } = require('../tenant/tenant.middleware');
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
router.use(identifyTenant);

router.get('/', getBookings);
router.get('/stats', getBookingStats);
router.get('/:id', getBookingById);
router.post('/', validateCreateBooking, validate, createBooking);
router.patch('/:id/status', validateUpdateStatus, validate, updateBookingStatus);
router.post('/:id/cancel', cancelBooking);
router.post('/:id/complete', completeBooking);
router.post('/:id/noshow', markNoShow);

module.exports = router;

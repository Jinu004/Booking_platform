const express = require('express');
const { requireAuth, requireRole } = require('../../auth/auth.middleware');
const {
  getDoctors,
  getDoctorById,
  createDoctor,
  updateAvailability,
  addLeave,
  getTokenQueue,
  updateTokenStatus,
  updateDoctor,
  deleteDoctor,
  getDoctorSchedule,
  saveDoctorSchedule,
  getProcedures,
  createProcedure,
  deleteProcedure,
  getAvailableSlots,
  createProcedureBooking,
  cancelProcedureBooking
} = require('./clinic.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/doctors', getDoctors);
router.get('/doctors/:id', getDoctorById);
router.post('/doctors', requireRole('admin', 'manager'), createDoctor);
router.patch('/doctors/:id', requireRole('admin', 'manager'), updateDoctor);
router.delete('/doctors/:id', requireRole('admin', 'manager'), deleteDoctor);
router.patch('/doctors/:id/availability', requireRole('admin', 'manager'), updateAvailability);
router.post('/doctors/:id/leave', requireRole('admin', 'manager'), addLeave);
router.get('/doctors/:id/schedule', getDoctorSchedule);
router.post('/doctors/:id/schedule', requireRole('admin', 'manager'), saveDoctorSchedule);

router.get('/tokens', getTokenQueue);
router.patch('/tokens/:id/status', updateTokenStatus);

router.get('/doctors/:id/procedures', getProcedures);
router.post('/doctors/:id/procedures', requireRole('admin', 'manager'), createProcedure);
router.delete('/procedures/:procedureId', requireRole('admin', 'manager'), deleteProcedure);
router.get('/doctors/:id/available-slots', getAvailableSlots);
router.post('/doctors/:id/procedure-booking', createProcedureBooking);
router.delete('/bookings/:bookingId/procedure', cancelProcedureBooking);

module.exports = router;

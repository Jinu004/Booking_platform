const express = require('express');
const { requireAuth, loadTenant } = require('../../auth/auth.middleware');
const {
  getDoctors,
  getDoctorById,
  createDoctor,
  updateAvailability,
  addLeave,
  getTokenQueue,
  updateTokenStatus
} = require('./clinic.controller');

const router = express.Router();

router.use(requireAuth);
router.use(loadTenant);

router.get('/doctors', getDoctors);
router.get('/doctors/:id', getDoctorById);
router.post('/doctors', createDoctor);
router.patch('/doctors/:id/availability', updateAvailability);
router.post('/doctors/:id/leave', addLeave);

router.get('/tokens', getTokenQueue);
router.patch('/tokens/:id/status', updateTokenStatus);

module.exports = router;

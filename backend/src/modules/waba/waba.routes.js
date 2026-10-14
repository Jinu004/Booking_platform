const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { initiateRegistration, verifyRegistration, getStatus, connectClinicNumber, requestSync } = require('./waba.controller');

const router = express.Router();

router.use(requireAuth);
router.use(requireRole('super_admin'));

router.post('/initiate', initiateRegistration);
router.post('/verify', verifyRegistration);
router.get('/status/:phoneNumberId', getStatus);
router.post('/connect', connectClinicNumber);
router.post('/sync', requestSync);

module.exports = router;

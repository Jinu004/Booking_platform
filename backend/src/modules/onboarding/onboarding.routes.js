const express = require('express');
const { onboardClinic, checkWhatsappAvailable, getPlans } = require('./onboarding.controller');
const { authLimiter } = require('../../middleware/rateLimiter');

const router = express.Router();

router.post('/clinic', authLimiter, onboardClinic);
router.get('/check-whatsapp/:number', authLimiter, checkWhatsappAvailable);
router.get('/plans', getPlans);

module.exports = router;

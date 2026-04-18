const express = require('express');
const { onboardClinic, checkWhatsappAvailable, getPlans } = require('./onboarding.controller');

const router = express.Router();

router.post('/clinic', onboardClinic);
router.get('/check-whatsapp/:number', checkWhatsappAvailable);
router.get('/plans', getPlans);

module.exports = router;

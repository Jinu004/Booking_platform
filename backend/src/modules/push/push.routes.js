const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { subscribe, getVapidKey } = require('./push.controller');
const router = express.Router();

router.get('/vapid-key', getVapidKey);
router.post('/subscribe', requireAuth, subscribe);

module.exports = router;

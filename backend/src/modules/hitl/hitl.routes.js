const express = require('express');
const router = express.Router();
const HITLController = require('./hitl.controller');
const { requireAuth } = require('../auth/auth.middleware');

// All routes require authenticated staff
router.use(requireAuth);

router.get('/conversations', HITLController.getConversations);
router.get('/conversations/:id/messages', HITLController.getMessages);
router.post('/conversations/:id/reply', HITLController.reply);
router.patch('/conversations/:id/mode', HITLController.toggleMode);
router.get('/events', HITLController.sseStream); // SSE — no body parser needed

module.exports = router;

const express = require('express');
const router = express.Router();
const HITLController = require('./hitl.controller');
const { requireAuth } = require('../auth/auth.middleware');

// For SSE route — EventSource cannot send headers, so token comes as query param
const sseAuth = (req, res, next) => {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
};

router.use(requireAuth);

router.get('/conversations', HITLController.getConversations);
router.get('/conversations/:id/messages', HITLController.getMessages);
router.post('/conversations/:id/reply', HITLController.reply);
router.patch('/conversations/:id/mode', HITLController.toggleMode);
router.get('/events', sseAuth, requireAuth, HITLController.sseStream);

module.exports = router;

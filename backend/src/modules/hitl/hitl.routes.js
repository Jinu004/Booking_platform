const express = require('express');
const router = express.Router();
const HITLController = require('./hitl.controller');
const { requireAuth, requireRole } = require('../auth/auth.middleware');

// For SSE route — EventSource cannot send headers, so token comes as query param
const sseAuth = (req, res, next) => {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
};

// SSE route uses sseAuth first, then requireAuth
router.get('/events', sseAuth, requireAuth, HITLController.sseStream);

// All other routes use requireAuth directly
router.get('/conversations', requireAuth, requireRole('admin', 'manager', 'receptionist'), HITLController.getConversations);
router.get('/conversations/:id/messages', requireAuth, requireRole('admin', 'manager', 'receptionist'), HITLController.getMessages);
router.post('/conversations/:id/send-template', requireAuth, requireRole('admin', 'manager', 'receptionist'), HITLController.sendTemplate);
router.post('/conversations/:id/reply', requireAuth, requireRole('admin', 'manager', 'receptionist'), HITLController.reply);
router.patch('/conversations/:id/mode', requireAuth, requireRole('admin', 'manager', 'receptionist'), HITLController.toggleMode);

module.exports = router;

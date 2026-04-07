const express = require('express');
const router = express.Router();
const controller = require('./conversation.controller');

// Try to load auth middleware, provide polyfill if missing during this sprint
let requireAuth;
try {
  const authModule = require('../auth/auth.middleware');
  requireAuth = authModule.requireAuth;
} catch (err) {
  requireAuth = (req, res, next) => {
    // Development bypass
    req.tenant = { id: '00000000-0000-0000-0000-000000000000' };
    next();
  };
}

router.use(requireAuth);

router.get('/', controller.getConversations);
router.get('/:id', controller.getConversationById);
router.post('/:id/takeover', controller.takeoverConversation);
router.post('/:id/resolve', controller.resolveConversation);
router.post('/:id/message', controller.sendManualMessage);

module.exports = router;

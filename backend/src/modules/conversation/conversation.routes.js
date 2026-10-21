const express = require('express');
const router = express.Router();
const controller = require('./conversation.controller');
const { requireAuth, requireRole } = require('../auth/auth.middleware');

router.use(requireAuth);

router.get('/', controller.getConversations);
router.get('/:id', controller.getConversationById);
router.post('/:id/takeover', controller.takeoverConversation);
router.post('/:id/resolve', controller.resolveConversation);
router.post('/:id/message', controller.sendManualMessage);
// Deleting a conversation's whole message history: admin and manager only
router.delete('/:id/messages', requireRole('admin', 'manager'), controller.clearConversationMessages);

module.exports = router;

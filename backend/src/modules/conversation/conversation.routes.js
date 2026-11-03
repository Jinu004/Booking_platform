const express = require('express');
const router = express.Router();
const controller = require('./conversation.controller');
const { requireAuth, requireRole } = require('../auth/auth.middleware');

router.use(requireAuth);

// Same role list as the HITL routes (hitl.routes.js)
const chatRoles = requireRole('admin', 'manager', 'receptionist', 'super_admin');

router.get('/', chatRoles, controller.getConversations);
router.get('/:id', chatRoles, controller.getConversationById);
router.post('/:id/takeover', chatRoles, controller.takeoverConversation);
router.post('/:id/resolve', chatRoles, controller.resolveConversation);
router.post('/:id/message', chatRoles, controller.sendManualMessage);
// Deleting a conversation's whole message history: admin and manager only
router.delete('/:id/messages', requireRole('admin', 'manager'), controller.clearConversationMessages);

module.exports = router;

import api from '../utils/api';

/**
 * Gets all active conversations for tenant
 * @returns {Promise<Array>} Conversations list
 */
export async function getConversations(params = {}) {
  return api.get('/conversations', { params });
}

export async function getConversationById(id) {
  return api.get(`/conversations/${id}`);
}

export async function takeoverConversation(id) {
  return api.post(`/conversations/${id}/takeover`);
}

export async function sendManualMessage(id, message) {
  return api.post(`/conversations/${id}/message`, { message });
}

// ── HITL API calls ───────────────────────────────────────────────────────

export const getHITLConversations = () =>
  api.get('/hitl/conversations');

export const getConversationMessages = (conversationId) =>
  api.get(`/hitl/conversations/${conversationId}/messages`);

export const sendStaffReply = (conversationId, content) =>
  api.post(`/hitl/conversations/${conversationId}/reply`, { content });

export const toggleConversationMode = (conversationId) =>
  api.patch(`/hitl/conversations/${conversationId}/mode`);

export const sendTemplate = (conversationId, templateName, languageCode = 'en', components = []) =>
  api.post(`/hitl/conversations/${conversationId}/send-template`, { templateName, languageCode, components });

import api from '../utils/api';

/**
 * Gets all active conversations for tenant
 * @returns {Promise<Array>} Conversations list
 */
export async function getConversations() {
  return api.get('/conversations');
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
  api.get('/v1/hitl/conversations');

export const getConversationMessages = (conversationId) =>
  api.get(`/v1/hitl/conversations/${conversationId}/messages`);

export const sendStaffReply = (conversationId, content) =>
  api.post(`/v1/hitl/conversations/${conversationId}/reply`, { content });

export const toggleConversationMode = (conversationId) =>
  api.patch(`/v1/hitl/conversations/${conversationId}/mode`);

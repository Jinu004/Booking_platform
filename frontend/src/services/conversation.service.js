import api from '../utils/api';

/**
 * Gets all active conversations for tenant
 * @returns {Promise<Array>} Conversations list
 */
export async function getConversations() {
  const response = await api.get('/conversations');
  return response.data?.data || [];
}

/**
 * Gets single conversation with messages
 * @param {string} id - Conversation UUID
 * @returns {Promise<object>} Conversation with messages
 */
export async function getConversationById(id) {
  const response = await api.get(`/conversations/${id}`);
  return response.data?.data || null;
}

/**
 * Takes over conversation from AI (HITL)
 * @param {string} id - Conversation UUID
 * @returns {Promise<object>} Updated conversation
 */
export async function takeoverConversation(id) {
  const response = await api.post(`/conversations/${id}/takeover`);
  return response.data?.data || null;
}

/**
 * Sends manual message in conversation
 * @param {string} id - Conversation UUID
 * @param {string} message - Message text
 * @returns {Promise<object>} Sent message
 */
export async function sendManualMessage(id, message) {
  const response = await api.post(`/conversations/${id}/message`, { message });
  return response.data?.data || null;
}

const pool = require('../../config/database');
const ConversationModel = require('./conversation.model');
const MessageModel = require('./message.model');
const { getOrCreateSession, updateSession, clearSession } = require('./conversation.session');
const logger = require('../../utils/logger');

/**
 * Handles incoming message from any channel
 * This is called by the webhook handler
 * Does:
 * 1. Find or create customer record
 * 2. Find or create conversation record
 * 3. Save message to database
 * 4. Update Redis session
 * 5. Return conversation context for AI engine
 *
 * @param {object} tenant - Tenant record
 * @param {object} message - Standardized message object
 * @returns {Promise<object>} Context for AI engine
 */
async function handleIncomingMessage(tenant, message) {
  const CRMService = require('../crm/crm.service');

  let customer = { id: null };

  // 1. Find or create customer
  try {
    customer = await CRMService.findOrCreateCustomer(
      tenant.id,
      message.from,
      message.customerName || ''
    );
  } catch (err) {
    logger.warn('Failed to find/create customer, proceeding with null ID:', err.message);
  }

  // 2. Find or create conversation record
  let conversation = null;
  if (customer.id) {
    conversation = await ConversationModel.getActiveConversation(pool, tenant.id, customer.id);
  }
  
  if (!conversation) {
    conversation = await ConversationModel.createConversation(pool, tenant.id, customer.id, message.provider);
  } else {
    await ConversationModel.touchConversation(pool, tenant.id, conversation.id);
  }

  // 3. Save message to database
  await MessageModel.saveMessage(pool, conversation.id, 'user', message.message, message.type);

  // 4. Update Redis session
  const session = await getOrCreateSession(tenant.id, message.from);
  const updatedSession = await updateSession(tenant.id, message.from, {
    messageCount: (session.messageCount || 0) + 1,
    lastMessage: message.message,
    lastMessageAt: message.timestamp || new Date().toISOString(),
    conversationId: conversation.id
  });

  // 5. Return conversation context for AI engine
  const recentMessages = await MessageModel.getRecentMessages(pool, conversation.id, 10);

  return { conversation, customer, recentMessages, session: updatedSession };
}

/**
 * Saves outbound message from AI or staff
 *
 * @param {string} conversationId
 * @param {string} content
 * @param {string} role - 'assistant' or 'staff'
 * @returns {Promise<object>} Saved message
 */
async function saveOutboundMessage(conversationId, content, role) {
  return await MessageModel.saveMessage(pool, conversationId, role, content, 'text');
}

/**
 * Resolves a conversation
 * Updates status, clears Redis session
 *
 * @param {string} tenantId
 * @param {string} conversationId
 * @returns {Promise<object>}
 */
async function resolveConversation(tenantId, conversationId) {
  const conversation = await ConversationModel.updateConversationStatus(pool, tenantId, conversationId, 'resolved');
  
  if (conversation && conversation.customer_id) {
    try {
      const c = await pool.query('SELECT phone FROM customers WHERE id = $1', [conversation.customer_id]);
      if (c.rows.length > 0) {
        await clearSession(tenantId, c.rows[0].phone);
      }
    } catch (err) {
      logger.warn('Failed to clear session during resolution:', err.message);
    }
  }
  
  return conversation;
}

/**
 * Escalates conversation to human staff (HITL)
 *
 * @param {string} tenantId
 * @param {string} conversationId
 * @param {string} staffId
 * @returns {Promise<object>}
 */
async function escalateToHuman(tenantId, conversationId, staffId) {
  return await ConversationModel.assignConversation(pool, tenantId, conversationId, staffId);
}

module.exports = {
  handleIncomingMessage,
  saveOutboundMessage,
  resolveConversation,
  escalateToHuman
};

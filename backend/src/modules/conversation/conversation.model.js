const tenantQuery = require('../../utils/tenantQuery')

/**
 * Creates a new conversation record
 * Called when patient sends first message
 *
 * @param {string} tenantId
 * @param {string} customerId
 * @param {string} channel - 'whatsapp', 'web', 'voice'
 * @returns {Promise<object>} Created conversation
 */
async function createConversation(pool, tenantId, customerId, channel) {
  const query = `
    INSERT INTO conversations (tenant_id, customer_id, channel, status)
    VALUES ($1, $2, $3, 'active')
    RETURNING *;
  `
  const result = await tenantQuery(tenantId, pool, query, [customerId, channel])
  return result.rows[0]
}

/**
 * Gets conversation by ID
 *
 * @param {string} tenantId
 * @param {string} conversationId
 * @returns {Promise<object|null>}
 */
async function getConversationById(pool, tenantId, conversationId) {
  const query = `
    SELECT * FROM conversations
    WHERE tenant_id = $1 AND id = $2;
  `
  const result = await tenantQuery(tenantId, pool, query, [conversationId])
  return result.rows[0] || null
}

/**
 * Gets active conversation for a customer
 * A customer can only have one active conversation
 *
 * @param {string} tenantId
 * @param {string} customerId
 * @returns {Promise<object|null>}
 */
async function getActiveConversation(pool, tenantId, customerId) {
  const query = `
    SELECT * FROM conversations
    WHERE tenant_id = $1 AND customer_id = $2 AND status = 'active'
    ORDER BY started_at DESC
    LIMIT 1;
  `
  const result = await tenantQuery(tenantId, pool, query, [customerId])
  return result.rows[0] || null
}

/**
 * Gets all conversations for a tenant
 * With optional status filter
 *
 * @param {string} tenantId
 * @param {string} status - optional filter
 * @returns {Promise<Array>}
 */
async function getConversations(pool, tenantId, status) {
  if (status) {
    const query = `
      SELECT * FROM conversations
      WHERE tenant_id = $1 AND status = $2
      ORDER BY last_message_at DESC;
    `
    const result = await tenantQuery(tenantId, pool, query, [status])
    return result.rows
  } else {
    const query = `
      SELECT * FROM conversations
      WHERE tenant_id = $1
      ORDER BY last_message_at DESC;
    `
    const result = await tenantQuery(tenantId, pool, query)
    return result.rows
  }
}

/**
 * Updates conversation status
 *
 * @param {string} tenantId
 * @param {string} conversationId
 * @param {string} status - 'active','resolved','escalated'
 * @returns {Promise<object>}
 */
async function updateConversationStatus(pool, tenantId, conversationId, status) {
  const query = `
    UPDATE conversations
    SET status = $2
    WHERE tenant_id = $1 AND id = $3
    RETURNING *;
  `
  const result = await tenantQuery(tenantId, pool, query, [status, conversationId])
  return result.rows[0]
}

/**
 * Updates last_message_at timestamp
 * Called every time a new message arrives
 *
 * @param {string} tenantId
 * @param {string} conversationId
 * @returns {Promise<void>}
 */
async function touchConversation(pool, tenantId, conversationId) {
  const query = `
    UPDATE conversations
    SET last_message_at = NOW()
    WHERE tenant_id = $1 AND id = $2;
  `
  await tenantQuery(tenantId, pool, query, [conversationId])
}

/**
 * Assigns conversation to staff member (HITL)
 *
 * @param {string} tenantId
 * @param {string} conversationId
 * @param {string} staffId
 * @returns {Promise<object>}
 */
async function assignConversation(pool, tenantId, conversationId, staffId) {
  const query = `
    UPDATE conversations
    SET assigned_to = $2, status = 'escalated'
    WHERE tenant_id = $1 AND id = $3
    RETURNING *;
  `
  const result = await tenantQuery(tenantId, pool, query, [staffId, conversationId])
  return result.rows[0]
}

module.exports = {
  createConversation,
  getConversationById,
  getActiveConversation,
  getConversations,
  updateConversationStatus,
  touchConversation,
  assignConversation
}

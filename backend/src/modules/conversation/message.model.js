/**
 * Saves a message to the database
 * Called for every inbound and outbound message
 *
 * @param {object} pool - Database pool
 * @param {string} conversationId
 * @param {string} role - 'user', 'assistant', 'system'
 * @param {string} content - Message text
 * @param {string} type - 'text', 'image', 'audio'
 * @returns {Promise<object>} Saved message
 */
async function saveMessage(pool, conversationId, role, content, type = 'text') {
  const query = `
    INSERT INTO messages (conversation_id, role, content, type)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
  `
  const result = await pool.query(query, [conversationId, role, content, type])
  return result.rows[0]
}

/**
 * Gets all messages for a conversation
 * Ordered by created_at ascending
 *
 * @param {object} pool
 * @param {string} conversationId
 * @returns {Promise<Array>} Messages array
 */
async function getMessages(pool, conversationId) {
  const query = `
    SELECT * FROM messages
    WHERE conversation_id = $1
    ORDER BY created_at ASC;
  `
  const result = await pool.query(query, [conversationId])
  return result.rows
}

/**
 * Gets last N messages for context window
 * Used by AI engine to get recent conversation history
 *
 * @param {object} pool
 * @param {string} conversationId
 * @param {number} limit - default 10
 * @returns {Promise<Array>} Recent messages
 */
async function getRecentMessages(pool, conversationId, limit = 10) {
  const query = `
    SELECT * FROM messages
    WHERE conversation_id = $1
    ORDER BY created_at DESC
    LIMIT $2;
  `
  const result = await pool.query(query, [conversationId, limit])
  // Reverse to return in chronological order
  return result.rows.reverse()
}

module.exports = {
  saveMessage,
  getMessages,
  getRecentMessages
}

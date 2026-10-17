const pool = require('../../config/database');

// WhatsApp only allows free-form messages within 24 hours of the patient's last message.
// The check uses 23 hours 55 minutes so a message does not fall outside the window while it is being sent.
const WINDOW_CLOSED_MESSAGE = 'The 24-hour window is closed. Use a template, or reply from the WhatsApp Business app.';
const PRESCRIPTION_WINDOW_CLOSED_MESSAGE = 'The 24-hour window is closed, so the prescription cannot be sent on WhatsApp now. Ask the patient to message the clinic, or send it from the WhatsApp Business app.';

// Error that routes turn into an HTTP 409 with a readable message
class WindowClosedError extends Error {
  constructor(message = WINDOW_CLOSED_MESSAGE) {
    super(message);
    this.name = 'WindowClosedError';
    this.statusCode = 409;
  }
}

/**
 * True when the patient's most recent message (messages.role = 'user') is less than 23 h 55 min old.
 * False when there is none or it is older. The time comparison is done by PostgreSQL.
 *
 * @param {string} tenantId
 * @param {{ conversationId?: string, phone?: string }} target - one conversation, or every conversation of the patient's phone number
 * @returns {Promise<boolean>}
 */
async function isWindowOpen(tenantId, { conversationId, phone } = {}) {
  let result;
  if (conversationId) {
    result = await pool.query(
      `SELECT COALESCE(MAX(m.created_at) > NOW() - INTERVAL '23 hours 55 minutes', false) AS open
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.conversation_id = $2 AND c.tenant_id = $1 AND m.role = 'user'`,
      [tenantId, conversationId]
    );
  } else if (phone) {
    // customers.phone is stored as +<digits>; accept the same number written with or without the plus
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return false;
    const candidates = [String(phone), `+${digits}`, digits];
    result = await pool.query(
      `SELECT COALESCE(MAX(m.created_at) > NOW() - INTERVAL '23 hours 55 minutes', false) AS open
       FROM customers cu
       JOIN conversations c ON c.customer_id = cu.id AND c.tenant_id = cu.tenant_id
       JOIN messages m ON m.conversation_id = c.id AND m.role = 'user'
       WHERE cu.tenant_id = $1 AND cu.phone = ANY($2::text[])`,
      [tenantId, candidates]
    );
  } else {
    return false;
  }
  return result.rows[0]?.open === true;
}

module.exports = {
  isWindowOpen,
  WindowClosedError,
  WINDOW_CLOSED_MESSAGE,
  PRESCRIPTION_WINDOW_CLOSED_MESSAGE
};

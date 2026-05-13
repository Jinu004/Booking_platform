const pool = require('../../config/database');

// Get conversation with mode, scoped to tenant
async function getConversationWithMode(conversationId, tenantId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.mode, c.status, c.assigned_to,c.needs_attention, c.customer_id,
            cu.phone AS customer_phone, cu.name AS customer_name
     FROM conversations c
     LEFT JOIN customers cu ON cu.id = c.customer_id
     WHERE c.id = $1 AND c.tenant_id = $2`,
    [conversationId, tenantId]
  );
  return rows[0] || null;
}

// Set conversation mode — 'ai' or 'human'
async function setMode(conversationId, tenantId, mode, staffId) {
  const assignedTo = mode === 'human' ? staffId : null;
  const { rows } = await pool.query(
    `UPDATE conversations
     SET mode = $1::varchar,
         mode_changed_at = NOW(),
         mode_changed_by = $2::uuid,
         assigned_to = COALESCE($3::uuid, assigned_to)

     WHERE id = $4::uuid AND tenant_id = $5::uuid
     RETURNING id, mode, assigned_to, mode_changed_at`,
    [mode, staffId, assignedTo, conversationId, tenantId]
  );
  return rows[0] || null;
}

// Get paginated messages for a conversation
// Messages have no tenant_id — scoped via conversation ownership check above
async function getMessages(conversationId, limit = 200) {
  const { rows } = await pool.query(
    `SELECT m.id, m.role, m.content, m.type, m.created_at
     FROM messages m
     WHERE m.conversation_id = $1
     ORDER BY m.created_at ASC
     LIMIT $2`,
    [conversationId, limit]
  );
  return rows;
}

// Get all conversations for tenant with latest message preview
async function getConversationList(tenantId, limit = 40) {
  const { rows } = await pool.query(
    `SELECT c.id, c.mode, c.status, c.last_message_at, c.assigned_to,
            cu.name AS customer_name, cu.phone AS customer_phone,
            (SELECT content FROM messages m
             WHERE m.conversation_id = c.id
             ORDER BY m.created_at DESC LIMIT 1) AS last_message,
            (SELECT role FROM messages m
             WHERE m.conversation_id = c.id
             ORDER BY m.created_at DESC LIMIT 1) AS last_message_role
     FROM conversations c
     LEFT JOIN customers cu ON cu.id = c.customer_id
     WHERE c.tenant_id = $1 AND c.status = 'active'
     ORDER BY c.last_message_at DESC
     LIMIT $2`,
    [tenantId, limit]
  );
  return rows;
}

// Get tenant working hours and handoff messages
async function getTenantSettings(tenantId) {
  const { rows } = await pool.query(
    `SELECT working_hours, handoff_message, out_of_hours_message
     FROM tenant_settings
     WHERE tenant_id = $1`,
    [tenantId]
  );
  return rows[0] || null;
}

module.exports = {
  getConversationWithMode,
  setMode,
  getMessages,
  getConversationList,
  getTenantSettings,
};

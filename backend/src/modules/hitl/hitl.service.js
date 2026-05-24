const HITLModel = require('./hitl.model');
const { sendMessage } = require('../channel/whatsapp/whatsapp.adapter');
const ConversationService = require('../conversation/conversation.service');
const logger = require('../../utils/logger');
const  pool  = require('../../config/database');
const { sendPushToTenant } = require('../push/push.service');
// ─── SSE Registry ────────────────────────────────────────────────────────────
// In-process store: tenantId → Set of SSE response objects
// (Works for single-process PM2. If you scale to cluster, replace with Redis pub/sub.)
const sseClients = new Map();

function getSseKey(tenantId) {
  return `tenant:${tenantId}`;
}

function addSseClient(tenantId, res) {
  const key = getSseKey(tenantId);
  if (!sseClients.has(key)) sseClients.set(key, new Set());
  sseClients.get(key).add(res);
}

function removeSseClient(tenantId, res) {
  const key = getSseKey(tenantId);
  const set = sseClients.get(key);
  if (set) {
    set.delete(res);
    if (set.size === 0) sseClients.delete(key);
  }
}

function broadcastToTenant(tenantId, event, data) {
  const key = getSseKey(tenantId);
  const set = sseClients.get(key);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch (err) {
      set.delete(res);
    }
  }
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks if current IST time is within tenant working hours.
 * @param {object} workingHours - JSONB from tenant_settings
 * @returns {boolean}
 */
function isWithinWorkingHours(workingHours) {
  const now = new Date();
  const istOptions = { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' };
  const parts = new Intl.DateTimeFormat('en-IN', istOptions).formatToParts(now);

  const weekday = parts.find(p => p.type === 'weekday')?.value?.toLowerCase(); // 'mon', 'tue'...
  const hour = parts.find(p => p.type === 'hour')?.value;
  const minute = parts.find(p => p.type === 'minute')?.value;
  const currentTime = `${hour}:${minute}`;

  const dayConfig = workingHours[weekday];
  if (!dayConfig || !dayConfig.enabled) return false;

  return currentTime >= dayConfig.open && currentTime < dayConfig.close;
}

/**
 * Called by the webhook when Gemini signals handoff: true.
 * Checks working hours, sends appropriate message to patient,
 * flips conversation mode, broadcasts SSE alert.
 */
async function handleAIHandoffRequest(tenant, conversation, staffId = null) {
  const settings = await HITLModel.getTenantSettings(tenant.id);

  if (!settings) {
    logger.warn(`No tenant_settings for tenant ${tenant.id}`);
    return { switched: false };
  }

  const withinHours = isWithinWorkingHours(settings.working_hours);

  if (!withinHours) {
    // Outside working hours — AI stays on, send out-of-hours message
    const customerPhone = conversation.customer_phone;
    if (customerPhone) {
      await sendMessage(customerPhone, settings.out_of_hours_message);
      await ConversationService.saveOutboundMessage(conversation.id, settings.out_of_hours_message, 'assistant');
    }
    return { switched: false, reason: 'outside_working_hours' };
  }


  // Send holding message to patient
  const customerPhone = conversation.customer_phone;
  if (customerPhone) {
    await sendMessage(customerPhone, settings.handoff_message);
    await ConversationService.saveOutboundMessage(conversation.id, settings.handoff_message, 'assistant');
  }

await pool.query(
    `UPDATE conversations SET needs_attention = true WHERE id = $1`,
    [conversation.id]
  );




  // Alert all staff dashboards
  broadcastToTenant(tenant.id, 'handoff_requested', {
    conversationId: conversation.id,
    customerName: conversation.customer_name,
    customerPhone: conversation.customer_phone,
    timestamp: new Date().toISOString(),
  });
  sendPushToTenant(tenant.id, {
    title: 'Patient needs attention',
    body: `${conversation.customer_name || conversation.customer_phone} has requested human support`,
    data: { conversationId: conversation.id, type: 'handoff_requested' }
  });

  return { switched: true };
}

/**
 * Staff sends a reply to a patient.
 * Saves to DB, sends via Meta Cloud API, broadcasts to dashboard.
 */
async function staffReply(conversationId, tenantId, staffId, content) {
  // Verify conversation belongs to tenant and is in human mode
  const conv = await HITLModel.getConversationWithMode(conversationId, tenantId);
  if (!conv) throw new Error('Conversation not found');
  if (conv.mode !== 'human') throw new Error('Conversation is not in human mode');

  // Save to DB
  const message = await ConversationService.saveOutboundMessage(conversationId, content, 'staff');

  // Send via WhatsApp
  await sendMessage(conv.customer_phone, content);
 

await pool.query(
    `UPDATE conversations SET needs_attention = false WHERE id = $1`,
    [conversationId]
  );





  // Broadcast to all staff watching this tenant
  broadcastToTenant(tenantId, 'new_message', {
    conversationId,
    message: {
      id: message.id,
      role: 'staff',
      content,
      created_at: message.created_at || new Date().toISOString(),
    },
  });
  return message;
}

/**
 * Toggle conversation mode between 'ai' and 'human'.
 * Called when staff manually clicks the toggle on the dashboard.
 */
async function toggleMode(conversationId, tenantId, staffId) {
  const conv = await HITLModel.getConversationWithMode(conversationId, tenantId);
  if (!conv) throw new Error('Conversation not found');

  const newMode = conv.mode === 'ai' ? 'human' : 'ai';
  const updated = await HITLModel.setMode(conversationId, tenantId, newMode, staffId);

  broadcastToTenant(tenantId, 'mode_changed', {
    conversationId,
    mode: newMode,
    timestamp: new Date().toISOString(),
  });

  return updated;
}

/**
 * Called by webhook for incoming patient messages when mode = 'human'.
 * Stores message (done by ConversationService already), just broadcasts SSE.
 */
function broadcastIncomingPatientMessage(tenantId, conversationId, content, customerName) {
  broadcastToTenant(tenantId, 'new_message', {
    conversationId,
    message: {
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    },
    customerName,
  });
}

module.exports = {
  addSseClient,
  removeSseClient,
  broadcastToTenant,
  broadcastIncomingPatientMessage,
  handleAIHandoffRequest,
  staffReply,
  toggleMode,
  isWithinWorkingHours,
};

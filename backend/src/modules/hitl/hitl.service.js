const HITLModel = require('./hitl.model');
const { sendMessage, sendTemplateMessage } = require('../channel/whatsapp/whatsapp.adapter');
const ConversationService = require('../conversation/conversation.service');
const logger = require('../../utils/logger');
const pool = require('../../config/database');
const { sendPushToTenant } = require('../push/push.service');
const { addSseClient, removeSseClient, broadcastToTenant } = require('./sse');

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
      try {
        await sendTemplateMessage(customerPhone, 'out_of_hours', 'en');
        await ConversationService.saveOutboundMessage(conversation.id, '[Out of hours — template message sent]', 'assistant');
      } catch (templateErr) {
        logger.warn('out_of_hours template failed, falling back to plain text:', templateErr.response?.data || templateErr.message);
        try {
          await sendMessage(customerPhone, settings.out_of_hours_message);
          await ConversationService.saveOutboundMessage(conversation.id, settings.out_of_hours_message, 'assistant');
        } catch (plainErr) {
          logger.error('out_of_hours plain text fallback also failed:', plainErr.response?.data || plainErr.message);
        }
      }
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

  // Save to DB (fast — must complete before we return)
  const message = await ConversationService.saveOutboundMessage(conversationId, content, 'staff');

  // Broadcast SSE immediately so message appears in dashboard instantly
  const phone = conv.customer_phone;
  const msgSnapshot = { id: message.id, role: 'staff', content, created_at: message.created_at || new Date().toISOString() };
  broadcastToTenant(tenantId, 'new_message', { conversationId, message: msgSnapshot });

  // WhatsApp send and DB update run in background (non-blocking)
  setImmediate(async () => {
    try {
      if (phone) await sendMessage(phone, content);
    } catch (err) {
      const metaCode = err.response?.data?.error?.code;
      if (metaCode === 131026) {
        logger.warn('24-hour window expired for staffReply — sending follow_up template instead');
        try {
          await sendTemplateMessage(phone, 'follow_up', 'en');
          await ConversationService.saveOutboundMessage(conversationId, '[24-hour window expired — re-engagement message sent to patient]', 'staff');
          broadcastToTenant(tenantId, 'new_message', {
            conversationId,
            message: { content: '[24-hour window expired — re-engagement message sent to patient]', sender_role: 'staff', created_at: new Date().toISOString() }
          });
        } catch (templateErr) {
          logger.error('follow_up template send also failed:', templateErr.response?.data || templateErr.message);
        }
      } else {
        logger.error('Background WhatsApp send failed:', err.response?.data || err.message);
      }
    }
    try {
      await pool.query(
        `UPDATE conversations SET needs_attention = false, mode_changed_at = NOW() WHERE id = $1`,
        [conversationId]
      );
    } catch (err) {
      logger.error('Background DB update failed:', err.message);
    }
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

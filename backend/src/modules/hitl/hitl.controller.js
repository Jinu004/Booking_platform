const HITLModel = require('./hitl.model');
const HITLService = require('./hitl.service');
const logger = require('../../utils/logger');
const pool = require('../../config/database');
const { sendTemplateMessage } = require('../channel/whatsapp/whatsapp.adapter');
const ConversationService = require('../conversation/conversation.service');
const { broadcastToTenant } = require('./sse');

// UUID v4 format validation helper
const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

// GET /api/hitl/conversations
async function getConversations(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const conversations = await HITLModel.getConversationList(tenantId, req.query.since);
    return res.json({ success: true, data: conversations, error: null });
  } catch (err) {
    next(err);
  }
}

// GET /api/hitl/conversations/:id/messages
async function getMessages(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ success: false, data: null, error: 'Invalid conversation ID' });

    // Verify ownership
    const conv = await HITLModel.getConversationWithMode(id, tenantId);
    if (!conv) return res.status(404).json({ success: false, data: null, error: 'Not found' });

    const messages = await HITLModel.getMessages(id);
    return res.json({ success: true, data: { conversation: conv, messages }, error: null });
  } catch (err) {
    next(err);
  }
}

// POST /api/hitl/conversations/:id/reply
async function reply(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const staffId = req.staff.id;
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ success: false, data: null, error: 'Invalid conversation ID' });
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, data: null, error: 'Message content required' });
    }

    const message = await HITLService.staffReply(id, tenantId, staffId, content.trim());
    return res.json({ success: true, data: message, error: null });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/hitl/conversations/:id/mode
async function toggleMode(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const staffId = req.staff.id;
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ success: false, data: null, error: 'Invalid conversation ID' });
    const updated = await HITLService.toggleMode(id, tenantId, staffId);
    return res.json({ success: true, data: updated, error: null });
  } catch (err) {
    next(err);
  }
}

// GET /api/hitl/events  — SSE stream
function sseStream(req, res) {
  const tenantId = req.tenant?.id;
  if (!tenantId) return res.status(401).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ tenantId })}\n\n`);

  HITLService.addSseClient(tenantId, res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    HITLService.removeSseClient(tenantId, res);
  });
}

async function sendTemplate(req, res) {
  try {
    const { id: conversationId } = req.params
    if (!isUUID(conversationId)) return res.status(400).json({ error: 'Invalid conversation ID' })
    const { templateName, languageCode = 'en', components = [] } = req.body
    if (!templateName) return res.status(400).json({ error: 'templateName is required' })

    // Check proactive_templates_enabled flag
    const configRow = await pool.query(`SELECT value FROM tenant_configs WHERE tenant_id = $1 AND key = $2`, [req.tenantId, 'proactive_templates_enabled'])
    const enabled = configRow.rows[0]?.value === 'true'
    if (!enabled) return res.status(403).json({ error: 'Proactive template messaging is not enabled for this tenant' })

    // Get conversation phone
    const convRow = await pool.query(`SELECT cu.phone FROM conversations c JOIN customers cu ON cu.id = c.customer_id WHERE c.id = $1 AND c.tenant_id = $2`, [conversationId, req.tenantId])
    if (!convRow.rows.length) return res.status(404).json({ error: 'Conversation not found' })
    const phone = convRow.rows[0].phone

    await sendTemplateMessage(phone, templateName, languageCode, components)
    const savedMessage = await ConversationService.saveOutboundMessage(conversationId, `[Template sent: ${templateName}]`, 'staff')
    broadcastToTenant(req.tenantId, 'new_message', {
      conversationId,
      message: {
        id: savedMessage.id,
        content: `[Template sent: ${templateName}]`,
        role: 'staff',
        created_at: savedMessage.created_at || new Date().toISOString()
      }
    })

    return res.json({ success: true })
  } catch (err) {
    logger.error('sendTemplate failed:', err?.response?.data || err?.message)
    return res.status(500).json({ error: 'Failed to send template' })
  }
}

module.exports = { getConversations, getMessages, reply, toggleMode, sseStream, sendTemplate };

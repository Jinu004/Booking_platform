const HITLModel = require('./hitl.model');
const HITLService = require('./hitl.service');
const logger = require('../../utils/logger');

// GET /api/hitl/conversations
async function getConversations(req, res) {
  try {
    const tenantId = req.tenant.id;
    const conversations = await HITLModel.getConversationList(tenantId);
    return res.json({ success: true, data: conversations, error: null });
  } catch (err) {
    logger.error('getConversations error:', err.message);
    return res.status(500).json({ success: false, data: null, error: err.message });
  }
}

// GET /api/hitl/conversations/:id/messages
async function getMessages(req, res) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;

    // Verify ownership
    const conv = await HITLModel.getConversationWithMode(id, tenantId);
    if (!conv) return res.status(404).json({ success: false, data: null, error: 'Not found' });

    const messages = await HITLModel.getMessages(id);
    return res.json({ success: true, data: { conversation: conv, messages }, error: null });
  } catch (err) {
    logger.error('getMessages error:', err.message);
    return res.status(500).json({ success: false, data: null, error: err.message });
  }
}

// POST /api/hitl/conversations/:id/reply
async function reply(req, res) {
  try {
    const tenantId = req.tenant.id;
    const staffId = req.staff.id;
    const { id } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, data: null, error: 'Message content required' });
    }

    const message = await HITLService.staffReply(id, tenantId, staffId, content.trim());
    return res.json({ success: true, data: message, error: null });
  } catch (err) {
    logger.error('reply error:', err.message);
    return res.status(500).json({ success: false, data: null, error: err.message });
  }
}

// PATCH /api/hitl/conversations/:id/mode
async function toggleMode(req, res) {
  try {
    const tenantId = req.tenant.id;
    const staffId = req.staff.id;
    const { id } = req.params;
    const updated = await HITLService.toggleMode(id, tenantId, staffId);
    return res.json({ success: true, data: updated, error: null });
  } catch (err) {
    logger.error('toggleMode error: ' + (err.message || JSON.stringify(err)) + ' stack: ' + err.stack);
    return res.status(500).json({ success: false, data: null, error: err.message || 'Unknown error' });
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

module.exports = { getConversations, getMessages, reply, toggleMode, sseStream };

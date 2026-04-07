const ConversationModel = require('./conversation.model');
const MessageModel = require('./message.model');
const ConversationService = require('./conversation.service');
const pool = require('../../config/database');
const { successResponse } = require('../../utils/response');
const logger = require('../../utils/logger');

/**
 * GET /conversations
 * Gets all conversations for tenant
 */
async function getConversations(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { status } = req.query;
    
    let conversations = await ConversationModel.getConversations(pool, tenantId, status);
    
    // Format conversations with patient phone and last message
    const formatted = await Promise.all(conversations.map(async (conv) => {
        let patientPhone = 'Unknown';
        if (conv.customer_id) {
            try {
                const c = await pool.query('SELECT phone FROM customers WHERE id = $1', [conv.customer_id]);
                if (c.rows.length > 0) patientPhone = c.rows[0].phone;
            } catch(e) {
                logger.warn('Failed to fetch customer phone:', e.message);
            }
        }
        
        let lastMessageText = '';
        const recent = await MessageModel.getRecentMessages(pool, conv.id, 1);
        if (recent.length > 0) {
            lastMessageText = recent[recent.length - 1].content;
        }

        return {
            id: conv.id,
            patientPhone,
            status: conv.status,
            lastMessage: lastMessageText,
            updatedAt: conv.last_message_at
        };
    }));

    return successResponse(res, formatted);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /conversations/:id
 * Gets single conversation with all messages
 */
async function getConversationById(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;

    const conversation = await ConversationModel.getConversationById(pool, tenantId, id);
    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const messages = await MessageModel.getMessages(pool, id);
    
    let patientPhone = 'Unknown';
    if (conversation.customer_id) {
        const c = await pool.query('SELECT phone FROM customers WHERE id = $1', [conversation.customer_id]);
        if (c.rows.length > 0) patientPhone = c.rows[0].phone;
    }

    const formattedMessages = messages.map(msg => ({
      id: msg.id,
      text: msg.content,
      direction: msg.role === 'user' ? 'inbound' : 'outbound',
      createdAt: msg.created_at
    }));

    const responseData = {
      id: conversation.id,
      patientPhone,
      status: conversation.status,
      handledBy: conversation.status === 'active' ? 'ai' : 'staff',
      messages: formattedMessages
    };
    
    return successResponse(res, responseData);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /conversations/:id/takeover
 * Staff takes over from AI (HITL)
 */
async function takeoverConversation(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    const staffId = req.user ? req.user.id : null; 

    // Ensure it exists
    const conversation = await ConversationModel.getConversationById(pool, tenantId, id);
    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const updated = await ConversationService.escalateToHuman(tenantId, id, staffId);
    return successResponse(res, updated);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /conversations/:id/resolve
 * Marks conversation as resolved
 */
async function resolveConversation(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;

    // Ensure it exists
    const conversation = await ConversationModel.getConversationById(pool, tenantId, id);
    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const resolved = await ConversationService.resolveConversation(tenantId, id);
    return successResponse(res, resolved);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /conversations/:id/message
 * Staff sends manual message
 */
async function sendManualMessage(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    const { message } = req.body;

    const conversation = await ConversationModel.getConversationById(pool, tenantId, id);
    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    const savedMsg = await ConversationService.saveOutboundMessage(id, message, 'staff');
    
    // Attempt sending via real WhatsApp adapter
    const adapter = require('../channel/whatsapp/whatsapp.adapter');
    let phone = '';
    if (conversation.customer_id) {
        const c = await pool.query('SELECT phone FROM customers WHERE id = $1', [conversation.customer_id]);
        if (c.rows.length > 0) phone = c.rows[0].phone;
    }

    if (phone) {
        await adapter.sendMessage(phone, message);
    }
    
    // Update Redis session
    const { getOrCreateSession, updateSession } = require('./conversation.session');
    if (phone) {
        const session = await getOrCreateSession(tenantId, phone);
        await updateSession(tenantId, phone, {
          messageCount: (session.messageCount || 0) + 1,
          lastMessage: message,
          lastMessageAt: new Date().toISOString()
        });
    }

    // Touch conversation to signify recent activity
    await ConversationModel.touchConversation(pool, tenantId, id);

    return successResponse(res, savedMsg);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getConversations,
  getConversationById,
  takeoverConversation,
  resolveConversation,
  sendManualMessage
};

// Inbound non-text WhatsApp messages (voice notes, images, videos, documents, stickers, locations, contacts, reactions, anything else).
// Nothing is downloaded: no media id or audio is kept and Gemini is not used. The message becomes a placeholder row for staff
// (counted for the 24-hour window), and voice notes, images, videos and documents get one polite plain-text reply per conversation
// per 5 minutes. Text, interactive and button messages never come here.

const PLACEHOLDERS = {
  audio: '🎤 Voice message',
  image: '📷 Image',
  video: '🎬 Video',
  document: '📄 Document',
  location: '📍 Location',
  sticker: '🙂 Sticker',
  contacts: '👤 Contact',
  reaction: '👍 Reaction',
  other: '📎 Attachment'
};

const FILE_REPLY = 'Thanks for sending that. I can\'t open images or files here yet, so please type your message and I\'ll help you. Our team can see it too.';
const REPLIES = {
  audio: 'Sorry, I can\'t listen to voice messages yet. 🙏 Please type your message and I\'ll help you right away. Our team can see your voice note too.',
  image: FILE_REPLY,
  video: FILE_REPLY,
  document: FILE_REPLY
};

const REPLY_LOCK_SECONDS = 300;

const errorClass = (err) => String((err && (err.name || err.code)) || 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);

/**
 * The handler with its dependencies injected (so it can be tested without a database or WhatsApp).
 *   deps.conversation.open(tenant, message, { updateWindow }) -> { conversation }   (finds or creates; updates last_inbound_at when asked)
 *   deps.saveInbound(conversationId, content, type)       deps.saveOutbound(conversationId, content)
 *   deps.broadcast(tenantId, event, payload)               deps.getMode(conversationId, tenantId) -> 'ai' | 'human' | ...
 *   deps.getConfigs(tenantId) -> { key: value }            deps.lock(key, seconds) -> true when taken, false when it already exists; throws on a Redis error
 *   deps.send(to, text)                                    deps.log.info/warn(text)
 * Returns a short result word (for logs and tests).
 */
function createMediaHandler(deps) {
  return async function handle({ tenant, message, source }) {
    const mediaType = PLACEHOLDERS[message.mediaType] ? message.mediaType : 'other';
    const content = PLACEHOLDERS[mediaType];

    // Placeholder for staff, counted for the window (a reaction does not extend it)
    const { conversation } = await deps.conversation.open(tenant, message, { updateWindow: mediaType !== 'reaction' });
    await deps.saveInbound(conversation.id, content, mediaType);
    deps.broadcast(tenant.id, 'new_message', {
      conversationId: conversation.id,
      message: { role: 'user', content, created_at: new Date().toISOString() }
    });

    const finish = (result) => {
      deps.log.info(`MEDIA_INBOUND tenant=${tenant.id} conv=${conversation.id} type=${mediaType} result=${result}`);
      return result;
    };

    // The automatic reply: only voice notes, images, videos and documents, only on Meta
    const replyText = REPLIES[mediaType];
    if (!replyText || source !== 'meta') return finish('stored');

    // Not in human mode (when the mode cannot be read, nothing is sent)
    let mode;
    try { mode = await deps.getMode(conversation.id, tenant.id); } catch (err) { return finish('stored_mode_unknown'); }
    if (mode === 'human') return finish('stored_human_mode');

    // Kill switch: only the exact value 'false' turns the reply off
    let configs;
    try { configs = await deps.getConfigs(tenant.id); } catch (err) { return finish('stored_config_unknown'); }
    if (configs && configs.media_auto_reply === 'false') return finish('stored_switch_off');

    // At most one reply per conversation per 5 minutes; a Redis problem means no reply
    let taken;
    try { taken = await deps.lock(`media_reply:${tenant.id}:${conversation.id}`, REPLY_LOCK_SECONDS); } catch (err) { return finish('stored_lock_error'); }
    if (!taken) return finish('stored_rate_limited');

    try {
      await deps.send(message.from, replyText);
      await deps.saveOutbound(conversation.id, replyText);
      deps.broadcast(tenant.id, 'new_message', {
        conversationId: conversation.id,
        message: { role: 'assistant', content: replyText, created_at: new Date().toISOString() }
      });
    } catch (err) {
      deps.log.warn(`MEDIA_REPLY_FAILED tenant=${tenant.id} class=${errorClass(err)}`);
      return finish('stored_send_failed');
    }
    return finish('stored_replied');
  };
}

function realDeps() {
  const ConversationService = require('../../conversation/conversation.service');
  const HITLService = require('../../hitl/hitl.service');
  const HITLModel = require('../../hitl/hitl.model');
  const TenantService = require('../../tenant/tenant.service');
  const adapter = require('./whatsapp.adapter');
  return {
    conversation: { open: (tenant, message, opts) => ConversationService.handleIncomingMediaMessage(tenant, message, opts) },
    saveInbound: (conversationId, content, type) => ConversationService.saveInboundMessage(conversationId, content, type),
    saveOutbound: (conversationId, content) => ConversationService.saveOutboundMessage(conversationId, content, 'assistant'),
    broadcast: (tenantId, event, payload) => HITLService.broadcastToTenant(tenantId, event, payload),
    getMode: async (conversationId, tenantId) => (await HITLModel.getConversationWithMode(conversationId, tenantId))?.mode,
    getConfigs: (tenantId) => TenantService.getAllConfigs(tenantId),
    lock: async (key, seconds) => {
      const redis = require('../../../config/redis');
      if (!redis) throw new Error('RedisUnavailable');
      return (await redis.set(key, '1', { NX: true, EX: seconds })) === 'OK';
    },
    send: (to, text) => adapter.sendMessage(to, text),
    log: require('../../../utils/logger')
  };
}

let sharedHandler = null;

/** The webhook entry. Never throws: any error is logged by class only. */
async function handleInboundMedia(args) {
  const logger = require('../../../utils/logger');
  try {
    if (!sharedHandler) sharedHandler = createMediaHandler(realDeps());
    return await sharedHandler(args);
  } catch (err) {
    logger.error(`MEDIA_INBOUND error class=${errorClass(err)} tenant=${args && args.tenant && args.tenant.id}`);
    return 'error';
  }
}

module.exports = { PLACEHOLDERS, REPLIES, REPLY_LOCK_SECONDS, createMediaHandler, handleInboundMedia };

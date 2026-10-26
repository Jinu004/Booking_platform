// Decides whether the "typing..." indicator (read receipt) is sent for one incoming patient message.
//
// Coexistence clinic = the clinic has its own Meta token AND a connection time (whatsapp_connected_at): it was connected with the
// coexistence Connect flow. Coexistence numbers get the indicator only when a super admin has opted the clinic in.
//
// tenant_configs key typing_indicator: 'false' = never send; 'true' = send (also for a coexistence clinic); anything else (unset) =
// send for a normal clinic, not for a coexistence clinic.
//
// Pure function: it reads nothing and calls nothing. The caller passes in values that are already loaded for the message.
//   source        'meta' or 'waha'
//   message       the parsed incoming message ({ messageId, type, interactiveId })
//   hasOwnToken   true when the clinic has its own token
//   connectedAt   tenants.whatsapp_connected_at (truthy when set)
//   typingConfig  the tenant_configs value of typing_indicator
function shouldSendTypingIndicator({ source, message, hasOwnToken, connectedAt, typingConfig }) {
  if (source !== 'meta') return false
  if (!message || !message.messageId) return false

  // Typed text, or a tap on a button or list row. Everything else (media, location, reactions, template quick replies) gets none.
  const isText = message.type === 'text'
  const isTap = message.type === 'interactive' && !!message.interactiveId
  if (!isText && !isTap) return false

  if (typingConfig === 'false') return false
  if (typingConfig === 'true') return true

  const isCoexistence = !!hasOwnToken && !!connectedAt
  return !isCoexistence
}

module.exports = { shouldSendTypingIndicator }

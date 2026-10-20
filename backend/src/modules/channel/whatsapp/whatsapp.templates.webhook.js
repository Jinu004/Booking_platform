const pool = require('../../../config/database')
const logger = require('../../../utils/logger')

// Meta "message_template_status_update" webhook: keeps tenant_templates.status current without a manual refresh.
// The WABA id is entry.id. The status vocabulary is Meta's own (the same values refreshTemplateStatuses stores from
// GET message_templates): APPROVED, REJECTED, PENDING, PAUSED, DISABLED, FLAGGED, IN_APPEAL, PENDING_DELETION, ...
// REINSTATED is the one event that is not a status: a reinstated template is APPROVED again.

const PROBLEM_EVENTS = new Set(['REJECTED', 'PAUSED', 'DISABLED', 'FLAGGED'])
const MAX_REASON_CHARS = 200

function statusFromEvent(event) {
  const status = String(event || '').trim().toUpperCase()
  if (!status) return null
  return status === 'REINSTATED' ? 'APPROVED' : status
}

async function handleOne(entry, value) {
  const event = String(value?.event || '').trim().toUpperCase()
  const status = statusFromEvent(event)
  const name = value?.message_template_name ? String(value.message_template_name) : null
  const language = value?.message_template_language ? String(value.message_template_language) : null
  if (!status || !name || !language) return

  const wabaId = entry?.id ? String(entry.id) : null
  const tenantRes = wabaId
    ? await pool.query('SELECT id FROM tenants WHERE whatsapp_waba_id = $1 LIMIT 1', [wabaId])
    : { rows: [] }
  const tenantId = tenantRes.rows[0]?.id
  if (!tenantId) {
    logger.info(`META_TEMPLATE_STATUS tenant=unknown event=${event}`)
    return
  }

  // The reason is stored only for the events that need attention; every other event clears it
  const reason = String(value?.reason || '').replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_CHARS)
  const lastError = PROBLEM_EVENTS.has(event) ? (reason && reason !== 'NONE' ? reason : event.toLowerCase()) : null
  const metaTemplateId = value?.message_template_id ? String(value.message_template_id) : null

  // Idempotent: the same event delivered twice leaves the same row. A template not in tenant_templates changes nothing.
  await pool.query(
    `UPDATE tenant_templates
     SET status = $4, last_error = $5, meta_template_id = COALESCE(meta_template_id, $6), updated_at = NOW()
     WHERE tenant_id = $1 AND name = $2 AND language = $3`,
    [tenantId, name, language, status, lastError, metaTemplateId]
  )

  const line = `META_TEMPLATE_STATUS tenant=${tenantId} name=${name} event=${event}`
  if (PROBLEM_EVENTS.has(event)) logger.warn(line)
  else logger.info(line)
}

/**
 * Records template status events of a webhook body. Never throws.
 * @param {object} body - the parsed webhook body
 */
async function handleTemplateStatusUpdates(body) {
  try {
    const entries = Array.isArray(body?.entry) ? body.entry : []
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : []
      for (const change of changes) {
        if (change?.field !== 'message_template_status_update') continue
        try {
          await handleOne(entry, change.value)
        } catch (itemErr) {
          logger.warn(`META_TEMPLATE_STATUS record error ${String(itemErr?.message || '').slice(0, 120)}`)
        }
      }
    }
  } catch (err) {
    try { logger.warn(`META_TEMPLATE_STATUS handler error ${String(err?.message || '').slice(0, 120)}`) } catch {}
  }
}

module.exports = { handleTemplateStatusUpdates }

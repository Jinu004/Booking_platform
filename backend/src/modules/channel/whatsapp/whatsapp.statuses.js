const crypto = require('crypto')
const pool = require('../../../config/database')
const logger = require('../../../utils/logger')

// Meta delivery status updates (entry[].changes[].value.statuses[]) for field "messages".
// Only status "failed" is recorded, into send_failures. sent, delivered and read are skipped immediately.
// Never stored or logged: the Meta message id (status.id) and recipient_id, because they encode the patient phone number.

const DEDUP_SECONDS = 24 * 60 * 60
const MAX_MESSAGE_CHARS = 300

// Short single-line text without long digit runs (phone numbers)
function safeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\d{10,}/g, '[number]')
    .trim()
    .slice(0, MAX_MESSAGE_CHARS)
}

// First time this failed status is seen: true. Seen before: false. Redis problems never block the recording.
async function isFirstDelivery(statusId) {
  try {
    const redisClient = require('../../../config/redis')
    if (!redisClient) return true
    const key = `status_dedup:${crypto.createHash('sha256').update(String(statusId)).digest('hex').slice(0, 32)}:failed`
    const stored = await redisClient.set(key, '1', { NX: true, EX: DEDUP_SECONDS })
    return stored === 'OK'
  } catch (redisErr) {
    return true
  }
}

async function recordFailedStatus(value, status) {
  const error = Array.isArray(status.errors) ? status.errors[0] : null
  const rawCode = Number(error?.code)
  const code = Number.isInteger(rawCode) ? rawCode : null
  const message = safeText([error?.title || error?.message, error?.error_data?.details].filter(Boolean).join(' - '))

  if (status.id && !(await isFirstDelivery(status.id))) return

  const phoneNumberId = value?.metadata?.phone_number_id ? String(value.metadata.phone_number_id) : null
  if (!phoneNumberId) {
    logger.info(`META_STATUS_FAILED tenant=unknown code=${code ?? 'none'}`)
    return
  }

  // Same tenant match as recordSendFailure: by the phone number id (unique on tenants); no row is written when no tenant matches
  const result = await pool.query(
    `INSERT INTO send_failures (tenant_id, ctx, template_name, meta_code, meta_subcode, http_status, error_message)
     SELECT id, 'async_status', NULL, $2::int, NULL, NULL, $3
     FROM tenants WHERE whatsapp_phone_number_id = $1
     LIMIT 1
     RETURNING tenant_id`,
    [phoneNumberId, code, message]
  )
  if (!result.rows.length) {
    logger.info(`META_STATUS_FAILED tenant=unknown code=${code ?? 'none'}`)
    return
  }
  logger.info(`META_STATUS_FAILED tenant=${result.rows[0].tenant_id} code=${code ?? 'none'} msg=${message}`)
}

/**
 * Records the failed delivery statuses of a webhook body. Never throws.
 * @param {object} body - the parsed webhook body
 */
async function handleStatusUpdates(body) {
  try {
    const entries = Array.isArray(body?.entry) ? body.entry : []
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : []
      for (const change of changes) {
        if (change?.field !== 'messages' || !Array.isArray(change?.value?.statuses)) continue
        for (const status of change.value.statuses) {
          if (status?.status !== 'failed') continue
          try {
            await recordFailedStatus(change.value, status)
          } catch (itemErr) {
            logger.warn(`META_STATUS_FAILED record error ${itemErr?.code || ''} ${String(itemErr?.message || '').slice(0, 120)}`)
          }
        }
      }
    }
  } catch (err) {
    try { logger.warn(`META_STATUS_FAILED handler error ${err?.code || ''} ${String(err?.message || '').slice(0, 120)}`) } catch {}
  }
}

module.exports = { handleStatusUpdates }

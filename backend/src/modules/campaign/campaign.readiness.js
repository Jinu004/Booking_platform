const axios = require('axios')
const pool = require('../../config/database')
const logger = require('../../utils/logger')
const redis = require('../../config/redis')
const { loadConnection, metaFailure, TemplateError, META_API_URL } = require('../waba/waba.templates.service')

// Pre-send readiness of a clinic for a poster campaign. Read only: nothing is sent and nothing is written (except the Redis cache).
// FAIL CLOSED: if Meta cannot be checked, ok is false.

const CACHE_SECONDS = 300
const REDIS_TIMEOUT_MS = 1500
const META_TIMEOUT_MS = 8000
const PAYMENT_ERROR_CODE = 141006
const PAYMENT_WINDOW_HOURS = 24
const DEFAULT_TIER = 'TIER_250'
const TIER_LIMITS = { TIER_250: 250, TIER_1K: 1000, TIER_10K: 10000, TIER_100K: 100000, TIER_UNLIMITED: null, UNLIMITED: null }
const PHONE_FIELDS = 'status,quality_rating,health_status,messaging_limit_tier'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const cacheKey = (tenantId) => `readiness:${tenantId}`

// A Redis call that can never hang a request: cache problems are ignored
function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('redis timeout')), REDIS_TIMEOUT_MS))
  ])
}

async function readCache(tenantId) {
  try {
    const raw = await withTimeout(redis.get(cacheKey(tenantId)))
    return raw ? JSON.parse(raw) : null
  } catch (_) {
    return null
  }
}

async function writeCache(tenantId, result) {
  try {
    await withTimeout(redis.set(cacheKey(tenantId), JSON.stringify(result), { EX: CACHE_SECONDS }))
  } catch (_) { /* a cache write failure changes nothing */ }
}

// Daily limit of a messaging tier; an absent or unknown tier counts as 250
function tierInfo(rawTier) {
  const tier = typeof rawTier === 'string' ? rawTier.toUpperCase() : null
  if (tier && Object.prototype.hasOwnProperty.call(TIER_LIMITS, tier)) {
    return { tier, daily_limit: TIER_LIMITS[tier], tier_known: true }
  }
  return { tier: tier || null, daily_limit: TIER_LIMITS[DEFAULT_TIER], tier_known: false }
}

/**
 * @param {string} tenantId
 * @param {{ fresh?: boolean }} options - fresh skips the cache read
 * @returns {Promise<{ ok: boolean, reasons: string[], details: object }>}
 */
async function getSendReadiness(tenantId, { fresh = false } = {}) {
  if (!UUID_RE.test(String(tenantId))) throw new TemplateError('Invalid tenant id', 400)
  if (!fresh) {
    const cached = await readCache(tenantId)
    if (cached) return { ...cached, details: { ...cached.details, cached: true } }
  }

  const reasons = []
  const details = { checked_at: new Date().toISOString(), cached: false }

  // 1. Clinic active (tenants.status is the kill switch)
  const tenantRes = await pool.query('SELECT status FROM tenants WHERE id = $1', [tenantId])
  details.tenant_status = tenantRes.rows[0]?.status ?? null
  if (!tenantRes.rows.length || tenantRes.rows[0].status !== 'active') reasons.push('clinic_not_active')

  // 2. Poster template approved
  const templateRes = await pool.query(
    `SELECT status FROM tenant_templates WHERE tenant_id = $1 AND name = 'clinic_poster' AND language = 'en'`,
    [tenantId]
  )
  details.poster_template_status = templateRes.rows[0]?.status ?? null
  if (templateRes.rows[0]?.status !== 'APPROVED') reasons.push('poster_template_not_approved')

  // 3. Payment problem: a 141006 send failure in the last 24 hours
  const paymentRes = await pool.query(
    `SELECT COUNT(*)::int AS n FROM send_failures
     WHERE tenant_id = $1 AND meta_code = $2 AND created_at > now() - ($3::int * interval '1 hour')`,
    [tenantId, PAYMENT_ERROR_CODE, PAYMENT_WINDOW_HOURS]
  )
  details.recent_payment_errors = paymentRes.rows[0].n
  if (paymentRes.rows[0].n > 0) reasons.push('payment_problem')

  // 4. Connection saved, then one light Meta GET for the phone node, with the clinic's own token
  let connection = null
  try {
    connection = await loadConnection(tenantId)
    if (!connection.phoneNumberId) {
      details.connection = 'phone_number_id_missing'
      connection = null
      reasons.push('phone_not_connected')
    }
  } catch (err) {
    if (err instanceof TemplateError && err.status === 400) {
      details.connection = 'not_saved'
      reasons.push('phone_not_connected')
    } else {
      // tenant missing or the stored token cannot be used: it cannot be checked, so fail closed
      details.connection = 'unreadable'
      reasons.push('meta_unreachable')
    }
  }

  let metaFailed = false
  if (connection) {
    try {
      const res = await axios.get(`${META_API_URL}/${connection.phoneNumberId}`, {
        headers: { Authorization: `Bearer ${connection.token}` },
        params: { fields: PHONE_FIELDS },
        timeout: META_TIMEOUT_MS
      })
      const data = res.data
      if (!data || typeof data !== 'object' || typeof data.status !== 'string') {
        throw new Error('unexpected response from Meta')
      }

      details.phone_status = data.status
      if (data.status.toUpperCase() !== 'CONNECTED') reasons.push('phone_not_connected')

      details.quality_rating = data.quality_rating ?? null
      if (String(data.quality_rating || '').toUpperCase() !== 'GREEN') reasons.push('quality_not_green')

      const canSend = data.health_status && typeof data.health_status === 'object' ? data.health_status.can_send_message : undefined
      if (typeof canSend === 'string' && canSend) {
        details.can_send_message = canSend
        if (canSend.toUpperCase() === 'BLOCKED') reasons.push('account_blocked')
      } else {
        details.can_send_message = 'absent'
      }

      Object.assign(details, tierInfo(data.messaging_limit_tier))
    } catch (err) {
      metaFailed = true
      reasons.push('meta_unreachable')
      details.meta_error = err.response ? metaFailure(err) : String(err.message || 'request failed').slice(0, 120)
    }
  }
  if (!connection) Object.assign(details, tierInfo(null))

  const result = { ok: reasons.length === 0, reasons: [...new Set(reasons)], details }
  logger.info(`CAMPAIGN_READINESS tenant=${tenantId} ok=${result.ok} reasons=${result.reasons.join(',') || 'none'}`)

  // A result that could not be checked against Meta is never cached
  if (!result.reasons.includes('meta_unreachable') && !metaFailed) await writeCache(tenantId, result)
  return result
}

module.exports = { getSendReadiness }

const crypto = require('crypto')
const pool = require('../../config/database')
const redis = require('../../config/redis')
const logger = require('../../utils/logger')
const senderContext = require('../channel/whatsapp/senderContext')
const { sendTemplateMessage, extractWamid } = require('../channel/whatsapp/whatsapp.meta')
const { getSendReadiness } = require('./campaign.readiness')
const { ensureCampaignMedia } = require('./campaign.media')
const { classifyRecipient, cleanCaption } = require('./campaign.service')
const { getBudgetSnapshot, isSendWindowOpen } = require('./campaign.budget')
const C = require('./campaign.config')

// Sends the clinic_poster template to the recipients of RUNNING campaigns, slowly, with safety stops.
// Called once a minute by cron/campaign.cron.js. Nothing here logs phone numbers, names or captions.

const TEMPLATE_NAME = 'clinic_poster'
const REDIS_TIMEOUT_MS = 1500
const MAX_ERROR_CHARS = 200
const PAUSE_CODES_TEXT = C.IMMEDIATE_PAUSE_CODES.map(String)

let tickRunning = false

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const withTimeout = (promise) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('redis timeout')), REDIS_TIMEOUT_MS))
])

const inWindow = isSendWindowOpen

// Marker for errors that must pause the campaign instead of counting as an ordinary send error
class PauseError extends Error {
  constructor(reason) {
    super(reason)
    this.pauseReason = reason
  }
}

// ---------------------------------------------------------------------------
// Variables ({{1}} name, {{2}} clinic, {{3}} caption)
// ---------------------------------------------------------------------------

// First word, letters and their combining marks only (any language), max 30 characters, 'there' when nothing is left
function firstNameVariable(name) {
  const firstWord = String(name || '').trim().split(/\s+/)[0] || ''
  const cleaned = firstWord.replace(/[^\p{L}\p{M}]/gu, '').slice(0, 30)
  return cleaned || 'there'
}

function collapse(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

async function pauseCampaign(tenantId, campaignId, reason) {
  const res = await pool.query(
    `UPDATE campaigns SET status = 'paused', paused_reason = $2, updated_at = now() WHERE id = $1 AND status = 'running'`,
    [campaignId, reason]
  )
  if (res.rowCount) logger.warn(`CAMPAIGN_PAUSED tenant=${tenantId} campaign=${campaignId} reason=${reason}`)
}

async function completeCampaign(tenantId, campaignId) {
  const res = await pool.query(
    `UPDATE campaigns SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = $1 AND status = 'running'`,
    [campaignId]
  )
  if (res.rowCount) logger.info(`CAMPAIGN_COMPLETED tenant=${tenantId} campaign=${campaignId}`)
}

// Fresh read of everything the stop checks need
async function readState(campaignId) {
  const res = await pool.query(
    `SELECT c.status AS campaign_status, c.tenant_id, c.caption, c.meta_media_id, c.daily_cap,
            t.status AS tenant_status, t.name AS clinic_name,
            (SELECT r.error_code FROM campaign_recipients r
              WHERE r.campaign_id = c.id AND r.error_code = ANY($2::text[]) LIMIT 1) AS immediate_code,
            (SELECT COUNT(*)::int FROM campaign_recipients r
              WHERE r.campaign_id = c.id AND r.status IN ('sent', 'failed')) AS attempted_total,
            (SELECT COUNT(*)::int FROM campaign_recipients r
              WHERE r.campaign_id = c.id AND r.status IN ('sent', 'failed') AND r.error_code = $3) AS undeliverable
     FROM campaigns c JOIN tenants t ON t.id = c.tenant_id
     WHERE c.id = $1`,
    [campaignId, PAUSE_CODES_TEXT, String(C.UNDELIVERABLE_CODE)]
  )
  return res.rows[0] || null
}

// null = carry on; otherwise { action: 'quiet' | 'pause', reason }
function evaluateStops(state) {
  if (!state || state.campaign_status !== 'running') return { action: 'quiet', reason: 'not_running' }
  if (state.tenant_status !== 'active') return { action: 'quiet', reason: 'tenant_not_active' }
  if (!inWindow()) return { action: 'quiet', reason: 'outside_window' }
  if (state.immediate_code) return { action: 'pause', reason: `meta_error_${state.immediate_code}` }
  if (state.attempted_total >= C.UNDELIVERABLE_MIN_SAMPLE && state.undeliverable / state.attempted_total > C.UNDELIVERABLE_RATIO) {
    return { action: 'pause', reason: 'many_undeliverable' }
  }
  return null
}

// Runs the stop checks against fresh data. A pause is applied here. Returns { state, stop } (stop is null to carry on).
async function stopCheck(tenantId, campaignId) {
  const state = await readState(campaignId)
  const stop = evaluateStops(state)
  if (stop && stop.action === 'pause') await pauseCampaign(tenantId, campaignId, stop.reason)
  return { state, stop }
}

// ---------------------------------------------------------------------------
// Redis lock (fail closed)
// ---------------------------------------------------------------------------

const lockKey = (campaignId) => `campaign:send:lock:${campaignId}`
const UNLOCK_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`

// Generic lock on any key (SET NX EX with a random token). The default lifetime is the campaign one; the weekly recall cron
// passes its own longer lifetime. Returns the token, or null when the lock is held or Redis is unavailable (fail closed).
async function acquireLockByKey(key, seconds = C.LOCK_SECONDS) {
  const token = crypto.randomBytes(16).toString('hex')
  try {
    const stored = await withTimeout(redis.set(key, token, { NX: true, EX: seconds }))
    return stored === 'OK' ? token : null
  } catch (err) {
    logger.warn(`LOCK_UNAVAILABLE key=${key} ${String(err.message || '').slice(0, 80)}`)
    return null
  }
}

// Releases the lock only if it still holds this run's own token
async function releaseLockByKey(key, token) {
  try {
    await withTimeout(redis.eval(UNLOCK_SCRIPT, { keys: [key], arguments: [token] }))
  } catch (_) { /* the lock expires on its own */ }
}

const acquireLock = (campaignId) => acquireLockByKey(lockKey(campaignId))
const releaseLock = (campaignId, token) => releaseLockByKey(lockKey(campaignId), token)

// Random pause between two sends
const randomGapMs = () => C.GAP_MIN_MS + Math.random() * (C.GAP_MAX_MS - C.GAP_MIN_MS)

// ---------------------------------------------------------------------------
// One recipient
// ---------------------------------------------------------------------------

function safeError(err) {
  const metaError = err?.response?.data?.error
  const rawCode = Number(metaError?.code)
  const code = Number.isInteger(rawCode) ? rawCode : null
  const rawSub = Number(metaError?.error_subcode)
  const subcode = Number.isInteger(rawSub) ? rawSub : null
  const text = String(metaError?.message || err?.message || 'send failed')
    .replace(/\s+/g, ' ')
    .replace(/\d{10,}/g, '[number]')
    .trim()
  const message = `${subcode !== null ? `[${subcode}] ` : ''}${text}`.slice(0, MAX_ERROR_CHARS)
  return { code, message }
}

async function markSkipped(recipientId, reason) {
  await pool.query(
    `UPDATE campaign_recipients SET status = 'skipped', skip_reason = $2 WHERE id = $1 AND status = 'pending'`,
    [recipientId, reason]
  )
}

/**
 * Handles one claimed recipient. Returns { attempted, outcome }:
 * attempted = a send was tried (so a pause follows the gap rules); outcome = 'sent' | 'failed' | 'skipped'.
 * Throws PauseError when the whole campaign must pause.
 */
async function processRecipient({ tenantId, campaignId, recipient, clinicName, caption, mediaId, counters }) {
  const log = (result, code) =>
    logger.info(`CAMPAIGN_SEND tenant=${tenantId} campaign=${campaignId} recipient=${recipient.id} result=${result} code=${code ?? 'none'}`)

  const customerRes = recipient.customer_id
    ? await pool.query(
        'SELECT phone, name, marketing_consent FROM customers WHERE id = $1 AND tenant_id = $2',
        [recipient.customer_id, tenantId]
      )
    : { rows: [] }
  const customer = customerRes.rows[0]
  if (!customer) {
    await markSkipped(recipient.id, 'customer_deleted')
    log('skipped', 'customer_deleted')
    return { attempted: false, outcome: 'skipped', processed: true }
  }

  // Consent is checked again now: a patient who pressed Stop offers after the audience was built gets nothing
  if (customer.marketing_consent !== 'all') {
    await markSkipped(recipient.id, 'opted_out')
    log('skipped', 'opted_out')
    return { attempted: false, outcome: 'skipped', processed: true }
  }

  if (classifyRecipient({ phone: customer.phone, marketingConsent: 'all' }).status !== 'pending') {
    await markSkipped(recipient.id, 'invalid_number')
    log('skipped', 'invalid_number')
    return { attempted: false, outcome: 'skipped', processed: true }
  }

  const components = [
    { type: 'header', parameters: [{ type: 'image', image: { id: mediaId } }] },
    {
      type: 'body',
      parameters: [
        { type: 'text', text: firstNameVariable(customer.name) },
        { type: 'text', text: clinicName },
        { type: 'text', text: caption }
      ]
    }
  ]

  try {
    const result = await senderContext.runAsTenant(tenantId, async () => {
      // Never fall back to the shared platform token
      if (!senderContext.getAccessToken() || !senderContext.getPhoneNumberId()) throw new PauseError('no_tenant_token')
      // From here a send is attempted: this row is never put back in the queue
      recipient.attempted = true
      return sendTemplateMessage(customer.phone, TEMPLATE_NAME, 'en', components)
    })
    const wamid = extractWamid(result)
    if (!wamid) logger.warn(`CAMPAIGN_NO_WAMID tenant=${tenantId} campaign=${campaignId} recipient=${recipient.id}`)
    await pool.query(
      `UPDATE campaign_recipients SET status = 'sent', wa_message_id = $2, sent_at = now() WHERE id = $1`,
      [recipient.id, wamid || null]
    )
    counters.consecutiveErrors = 0
    log('sent')
    return { attempted: true, outcome: 'sent', processed: true }
  } catch (err) {
    if (err instanceof PauseError) throw err
    const { code, message } = safeError(err)
    // An error without a Meta error code (timeout, dropped connection, odd response) may still have been delivered:
    // the row is failed, never retried and never left pending, the same treatment as a stale claim
    const storedMessage = code === null ? 'interrupted_unknown_state' : message
    await pool.query(
      `UPDATE campaign_recipients SET status = 'failed', error_code = $2, error_message = $3 WHERE id = $1`,
      [recipient.id, code !== null ? String(code) : null, storedMessage]
    )
    log('failed', code)
    counters.consecutiveErrors += 1
    if (code !== null && C.IMMEDIATE_PAUSE_CODES.includes(code)) throw new PauseError(`meta_error_${code}`)
    if (counters.consecutiveErrors >= C.REPEATED_ERROR_LIMIT) throw new PauseError('repeated_send_errors')
    return { attempted: true, outcome: 'failed', processed: true }
  }
}

// ---------------------------------------------------------------------------
// One campaign (one batch)
// ---------------------------------------------------------------------------

async function processCampaign(campaign) {
  const { id: campaignId, tenant_id: tenantId } = campaign
  const lockToken = await acquireLock(campaignId)
  if (!lockToken) return // another run holds it, or Redis is unavailable: never send without the lock

  const claimed = []
  try {
    await pool.query('UPDATE campaigns SET started_at = now() WHERE id = $1 AND started_at IS NULL', [campaignId])

    // A claim older than the limit with no Meta message id may or may not have been sent: never retry it
    await pool.query(
      `UPDATE campaign_recipients SET status = 'failed', error_message = 'interrupted_unknown_state'
       WHERE campaign_id = $1 AND status = 'pending' AND wa_message_id IS NULL
         AND claimed_at IS NOT NULL AND claimed_at < now() - ($2::int * interval '1 minute')`,
      [campaignId, C.STALE_CLAIM_MINUTES]
    )

    // Batch start: stop checks, readiness, media
    let { state, stop } = await stopCheck(tenantId, campaignId)
    if (stop) return

    const readiness = await getSendReadiness(tenantId, { fresh: true })
    if (!readiness.ok) {
      if (readiness.reasons.length === 1 && readiness.reasons[0] === 'meta_unreachable') return
      await pauseCampaign(tenantId, campaignId, readiness.reasons.join(','))
      return
    }

    let mediaId = state.meta_media_id
    if (!mediaId) {
      try {
        mediaId = await ensureCampaignMedia(tenantId, campaignId)
      } catch (err) {
        logger.warn(`CAMPAIGN_MEDIA_FAILED tenant=${tenantId} campaign=${campaignId}`)
        await pauseCampaign(tenantId, campaignId, 'media_upload_failed')
        return
      }
    }

    const caption = cleanCaption(state.caption)
    if (!caption) {
      await pauseCampaign(tenantId, campaignId, 'caption_empty')
      return
    }
    const clinicName = collapse(state.clinic_name)

    // Budget and first-campaign cap: shared with the preview and confirm endpoints (campaign.budget.js)
    const snap = await getBudgetSnapshot(tenantId, campaignId, readiness.details)
    if (snap.remaining !== null && snap.remaining <= 0) return // resumes when the rolling window frees up
    let size = Math.min(C.BATCH_SIZE, snap.remaining === null ? Infinity : snap.remaining)
    if (snap.isFirstCampaign) {
      if (snap.firstCampaignRemaining <= 0) {
        await pool.query(
          `UPDATE campaign_recipients SET status = 'skipped', skip_reason = 'first_campaign_limit'
           WHERE campaign_id = $1 AND status = 'pending' AND claimed_at IS NULL`,
          [campaignId]
        )
        await completeCampaign(tenantId, campaignId)
        return
      }
      size = Math.min(size, snap.firstCampaignRemaining)
    }
    if (snap.dailyCapRemaining !== null) size = Math.min(size, snap.dailyCapRemaining)
    if (size <= 0) return

    // Claim atomically; rows are released again in the finally block if they are not attempted
    const claimRes = await pool.query(
      `UPDATE campaign_recipients SET claimed_at = now(), attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM campaign_recipients
         WHERE campaign_id = $1 AND status = 'pending' AND claimed_at IS NULL
         ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED
       )
       RETURNING id, customer_id`,
      [campaignId, size]
    )
    claimed.push(...claimRes.rows.map(row => ({ ...row, processed: false, attempted: false })))

    if (!claimed.length) {
      const left = await pool.query(`SELECT COUNT(*)::int AS n FROM campaign_recipients WHERE campaign_id = $1 AND status = 'pending'`, [campaignId])
      if (left.rows[0].n === 0) await completeCampaign(tenantId, campaignId)
      return
    }

    const counters = { consecutiveErrors: 0 }
    for (let i = 0; i < claimed.length; i++) {
      const recipient = claimed[i]
      const check = await stopCheck(tenantId, campaignId)
      if (check.stop) break

      let result
      try {
        result = await processRecipient({ tenantId, campaignId, recipient, clinicName, caption, mediaId, counters })
      } catch (err) {
        if (err instanceof PauseError) {
          recipient.processed = recipient.attempted // a pause before any attempt puts the row back
          await pauseCampaign(tenantId, campaignId, err.pauseReason)
          break
        }
        throw err
      }
      recipient.processed = result.processed

      if (result.attempted && i < claimed.length - 1) {
        await sleep(randomGapMs())
      }
    }

    // Everything done and nothing pending: finish now instead of waiting for the next tick
    const left = await pool.query(`SELECT COUNT(*)::int AS n FROM campaign_recipients WHERE campaign_id = $1 AND status = 'pending'`, [campaignId])
    if (left.rows[0].n === 0) await completeCampaign(tenantId, campaignId)
  } finally {
    // Claimed rows that were never attempted go back to the queue. A row with a send attempt is never released.
    const unattempted = claimed.filter(r => !r.processed && !r.attempted).map(r => r.id)
    if (unattempted.length) {
      try {
        await pool.query(
          `UPDATE campaign_recipients SET claimed_at = NULL, attempts = attempts - 1
           WHERE id = ANY($1::uuid[]) AND status = 'pending' AND wa_message_id IS NULL`,
          [unattempted]
        )
      } catch (releaseErr) {
        logger.error(`CAMPAIGN_RELEASE_FAILED campaign=${campaignId} ${String(releaseErr.message || '').slice(0, 120)}`)
      }
    }
    await releaseLock(campaignId, lockToken)
  }
}

/**
 * One tick: one batch for each running campaign, oldest first. Never throws.
 */
async function runCampaignTick() {
  if (tickRunning) return // the previous tick is still sending (batches take minutes)
  if (!inWindow()) return // outside the daytime window nothing is sent; running campaigns stay running
  tickRunning = true
  try {
    const res = await pool.query(`SELECT id, tenant_id FROM campaigns WHERE status = 'running' ORDER BY created_at ASC`)
    for (const campaign of res.rows) {
      try {
        await processCampaign(campaign)
      } catch (err) {
        logger.error(`CAMPAIGN_TICK_ERROR tenant=${campaign.tenant_id} campaign=${campaign.id} ${String(err.message || '').slice(0, 160)}`)
      }
    }
  } catch (err) {
    logger.error(`CAMPAIGN_TICK_FAILED ${String(err.message || '').slice(0, 160)}`)
  } finally {
    tickRunning = false
  }
}

// The lock, gap and error helpers are shared with the weekly recall cron
module.exports = { runCampaignTick, acquireLockByKey, releaseLockByKey, randomGapMs, sleep, safeError }

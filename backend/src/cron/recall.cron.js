const cron = require('node-cron')
const pool = require('../config/database')
const logger = require('../utils/logger')
// Weekly recall: the MARKETING template recall_checkup, sent with the same safeguards as campaigns
// (readiness, daily allowance, daytime window, pacing, pause codes, Redis lock, clinic's own token only).
// The logs hold clinic ids and counts only: never a phone number, name or token.
const { sendTemplateMessage } = require('../modules/channel/whatsapp/whatsapp.meta')
const senderContext = require('../modules/channel/whatsapp/senderContext')
const { getSendReadiness } = require('../modules/campaign/campaign.readiness')
const { getDailyAllowance, isSendWindowOpen } = require('../modules/campaign/campaign.budget')
const { classifyRecipient, FREQUENCY_CAP_DAYS } = require('../modules/campaign/campaign.service')
const { acquireLockByKey, releaseLockByKey, randomGapMs, sleep, safeError } = require('../modules/campaign/campaign.sender')
const C = require('../modules/campaign/campaign.config')
const { greetingName } = require('../utils/patientName')

const RECALL_LOCK_KEY = 'recall:run:lock'
const CANDIDATE_BATCH = 300

// Clinics that have at least one patient due for a recall (the same conditions as before)
const CLINICS_SQL = `
  SELECT DISTINCT t.id AS tenant_id, t.name AS clinic_name
  FROM customers c
  JOIN tenants t ON t.id = c.tenant_id
  WHERE c.last_seen < NOW() - INTERVAL '90 days'
    AND t.status = 'active'
    AND c.phone IS NOT NULL
    AND c.name IS NOT NULL
    AND c.marketing_consent IN ('all', 'checkups')
    AND NOT EXISTS (
      SELECT 1 FROM tenant_configs tc
      WHERE tc.tenant_id = t.id AND tc.key = 'recall_enabled' AND tc.value = 'false'
    )
  ORDER BY t.name`

// Patients of one clinic due for a recall. Also left out: anyone who got a recall in the last 90 days (any outcome),
// anyone who got a campaign message in the last FREQUENCY_CAP_DAYS days, and anyone marked undeliverable.
const CANDIDATES_SQL = `
  SELECT c.id AS customer_id,
         COALESCE(c.name, 'there') AS patient_name,
         c.phone,
         GREATEST(1, EXTRACT(MONTH FROM AGE(NOW(), c.last_seen))::int) AS months_since_visit
  FROM customers c
  WHERE c.tenant_id = $1
    AND c.last_seen < NOW() - INTERVAL '90 days'
    AND c.phone IS NOT NULL
    AND c.name IS NOT NULL
    AND c.marketing_consent IN ('all', 'checkups')
    AND NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.customer_id = c.id AND n.type = 'recall_checkup' AND n.sent_at > NOW() - INTERVAL '90 days'
    )
    AND NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.customer_id = c.id AND n.type = 'recall_checkup' AND n.status = 'undeliverable'
    )
    AND NOT EXISTS (
      SELECT 1 FROM campaign_recipients r
      WHERE r.tenant_id = c.tenant_id AND r.customer_id = c.id
        AND (r.sent_at > NOW() - ($2::int * INTERVAL '1 day') OR r.error_code = $3)
    )
  ORDER BY c.last_seen ASC, c.id
  LIMIT ${CANDIDATE_BATCH}`

// Stored so the 90-day repeat rule, the 21-day frequency rule and the daily allowance can see the send.
// status: 'sent' (counted in the allowance), 'unknown' (outcome not known: never retried) or 'undeliverable' (never recalled again).
async function recordRecall(tenantId, customerId, status) {
  await pool.query(
    `INSERT INTO notifications (tenant_id, customer_id, type, channel, status, scheduled_at, sent_at)
     VALUES ($1, $2, 'recall_checkup', 'whatsapp', $3, NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [tenantId, customerId, status]
  )
}

// Fresh state read immediately before each patient
async function freshState(tenantId, customerId) {
  const res = await pool.query(
    `SELECT c.phone, c.marketing_consent, t.status AS tenant_status,
            EXISTS (SELECT 1 FROM campaigns cp WHERE cp.tenant_id = c.tenant_id AND cp.status IN ('running', 'paused')) AS campaign_active
     FROM customers c JOIN tenants t ON t.id = c.tenant_id
     WHERE c.id = $1 AND c.tenant_id = $2`,
    [customerId, tenantId]
  )
  return res.rows[0] || null
}

/**
 * Recall for one clinic. Returns { windowClosed } so the run can stop cleanly when the daytime window ends.
 */
async function recallClinic(clinic, totals) {
  const tenantId = clinic.tenant_id
  const stats = { sent: 0, skipped_consent: 0, skipped_invalid: 0, unknown: 0, undeliverable: 0, failed: 0, stopped: 'none' }
  const finish = (reason, windowClosed = false) => {
    totals.sent += stats.sent
    logger.info(
      `RECALL_CLINIC tenant=${tenantId} sent=${stats.sent} skipped_consent=${stats.skipped_consent} skipped_invalid=${stats.skipped_invalid} ` +
      `unknown=${stats.unknown} undeliverable=${stats.undeliverable} failed=${stats.failed} stopped=${stats.stopped}${reason ? ` skipped_clinic=${reason}` : ''}`
    )
    return { windowClosed }
  }

  // Recall and a campaign never send for the same clinic at the same time
  const active = await pool.query(
    `SELECT 1 FROM campaigns WHERE tenant_id = $1 AND status IN ('running', 'paused') LIMIT 1`,
    [tenantId]
  )
  if (active.rows.length) return finish('campaign_active')

  // Marketing recall uses the clinic's own token only (no platform-token fallback)
  const conn = await pool.query('SELECT whatsapp_access_token_enc, whatsapp_phone_number_id FROM tenants WHERE id = $1', [tenantId])
  if (!conn.rows[0]?.whatsapp_access_token_enc || !conn.rows[0]?.whatsapp_phone_number_id) return finish('no_own_token')

  const readiness = await getSendReadiness(tenantId, { fresh: false })
  if (!readiness.ok) return finish(`not_ready:${readiness.reasons.join(',')}`)

  const allowance = await getDailyAllowance(tenantId, readiness.details)
  const maxToSend = Math.min(allowance.remaining === null ? Infinity : allowance.remaining, C.RECALL_MAX_PER_CLINIC_PER_RUN)
  if (maxToSend <= 0) return finish('no_allowance')

  const candidates = (await pool.query(CANDIDATES_SQL, [tenantId, FREQUENCY_CAP_DAYS, String(C.UNDELIVERABLE_CODE)])).rows
  let consecutiveErrors = 0

  for (let i = 0; i < candidates.length && stats.sent < maxToSend; i++) {
    const row = candidates[i]
    if (!isSendWindowOpen()) { stats.stopped = 'window_closed'; return finish(null, true) }

    const state = await freshState(tenantId, row.customer_id)
    if (!state || state.tenant_status !== 'active') { stats.stopped = 'clinic_not_active'; break }
    if (state.campaign_active) { stats.stopped = 'campaign_active'; break }
    if (!['all', 'checkups'].includes(state.marketing_consent)) { stats.skipped_consent++; continue }
    if (classifyRecipient({ phone: state.phone, marketingConsent: 'all' }).status !== 'pending') { stats.skipped_invalid++; continue }

    let attempted = false
    try {
      await senderContext.runAsTenant(tenantId, async () => {
        // Never fall back to the shared platform token
        if (!senderContext.getAccessToken() || !senderContext.getPhoneNumberId()) {
          throw Object.assign(new Error('no_tenant_token'), { noToken: true })
        }
        attempted = true
        return sendTemplateMessage(state.phone, 'recall_checkup', 'en', [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: greetingName(row.patient_name) }, // letters of any script only, no emoji/line breaks, 30 characters, "there" if empty
              { type: 'text', text: String(row.months_since_visit) },
              { type: 'text', text: clinic.clinic_name }
            ]
          }
        ])
      })
      await recordRecall(tenantId, row.customer_id, 'sent')
      stats.sent++
      consecutiveErrors = 0
    } catch (err) {
      if (err.noToken) { stats.stopped = 'no_own_token'; break }
      const { code } = safeError(err)
      if (code === null) {
        // No Meta error code (timeout, dropped connection): the message may have been delivered, so it is never retried
        if (attempted) { await recordRecall(tenantId, row.customer_id, 'unknown').catch(() => {}) }
        stats.unknown++
        consecutiveErrors++
      } else if (C.IMMEDIATE_PAUSE_CODES.includes(code)) {
        stats.stopped = String(code)
        break
      } else if (code === C.UNDELIVERABLE_CODE) {
        await recordRecall(tenantId, row.customer_id, 'undeliverable').catch(() => {})
        stats.undeliverable++
      } else {
        stats.failed++
        consecutiveErrors++
      }
      if (consecutiveErrors >= C.REPEATED_ERROR_LIMIT) { stats.stopped = 'repeated_errors'; break }
    }

    // Pace the sends (no database transaction is open during the wait)
    if (i < candidates.length - 1 && stats.sent < maxToSend) await sleep(randomGapMs())
  }
  return finish(null)
}

async function runRecall() {
  // One run at a time, for the whole run. Without Redis the run is skipped (fail closed).
  const lockToken = await acquireLockByKey(RECALL_LOCK_KEY, C.RECALL_LOCK_SECONDS)
  if (!lockToken) {
    logger.warn('RECALL_RUN skipped: lock not acquired or Redis unavailable')
    return
  }
  try {
    if (!isSendWindowOpen()) {
      logger.info('RECALL_RUN skipped: outside the sending window')
      return
    }
    const clinics = (await pool.query(CLINICS_SQL)).rows
    const totals = { sent: 0 }
    let processed = 0
    for (const clinic of clinics) {
      try {
        const { windowClosed } = await recallClinic(clinic, totals)
        processed++
        if (windowClosed) break
      } catch (clinicErr) {
        logger.error(`RECALL_CLINIC_ERROR tenant=${clinic.tenant_id} ${String(clinicErr.message || '').slice(0, 120)}`)
      }
    }
    logger.info(`RECALL_RUN clinics_due=${clinics.length} clinics_processed=${processed} sent=${totals.sent}`)
  } finally {
    await releaseLockByKey(RECALL_LOCK_KEY, lockToken)
  }
}

function startRecallCron() {
  // Runs every Monday at 10:00 AM IST
  cron.schedule('0 10 * * 1', async () => {
    logger.info('Running recall checkup cron...')
    try {
      await runRecall()
    } catch (err) {
      logger.error(`Recall cron failed: ${String(err.message || '').slice(0, 160)}`)
    }
  }, { timezone: 'Asia/Kolkata' })
  logger.info('Recall cron started (runs every Monday at 10:00 AM IST)')
}

module.exports = { startRecallCron, runRecall }

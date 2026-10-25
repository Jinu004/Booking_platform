const cron = require('node-cron')
const pool = require('../config/database')
const logger = require('../utils/logger')
// Day-10 reminder: coexistence clinics are disconnected by WhatsApp when the Business app is not opened for about 14 days.
// Push only (no WhatsApp message, no email). The logs hold clinic ids and counts only.
const { sendPushToTenant } = require('../modules/push/push.service')
const { acquireLockByKey } = require('../modules/campaign/campaign.sender')
const TenantService = require('../modules/tenant/tenant.service')

const FIRST_REMINDER_DAYS = 10
const SECOND_REMINDER_DAYS = 12
const RUN_LOCK_SECONDS = 6 * 60 * 60
const DAY_MS = 24 * 60 * 60 * 1000
const PUSH_TITLE = 'WhatsApp Business app'
const PUSH_BODY = 'Please open your WhatsApp Business app on your phone today. If it is not opened for about 14 days, WhatsApp disconnects it from ReceptionAI.'

// One query for every eligible clinic. ref_time = the latest of the last staff echo, the connect time and the last state change
// (GREATEST ignores missing values). A missing wa_connection_state counts as connected; a disconnected or offboarded clinic is left out.
// Echo rows carry no marker of their own (handleStaffEcho stores role 'staff', type 'text', no wamid), so system-written staff rows are
// excluded by their text instead: "[Template sent..." (dashboard template send) and "[24-hour..." (window-expired notice). A heuristic.
const ELIGIBLE_SQL = `
  SELECT t.id AS tenant_id,
         GREATEST(
           t.whatsapp_connected_at,
           e.last_echo_at,
           CASE WHEN cs.value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN cs.value::timestamptz END
         ) AS ref_time,
         rl.value AS last_reminder
  FROM tenants t
  LEFT JOIN tenant_configs st ON st.tenant_id = t.id AND st.key = 'wa_connection_state'
  LEFT JOIN tenant_configs cs ON cs.tenant_id = t.id AND cs.key = 'wa_state_changed_at'
  LEFT JOIN tenant_configs en ON en.tenant_id = t.id AND en.key = 'wa_app_reminder_enabled'
  LEFT JOIN tenant_configs rl ON rl.tenant_id = t.id AND rl.key = 'wa_app_reminder_last'
  LEFT JOIN (
    SELECT c.tenant_id, MAX(m.created_at) AS last_echo_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.role = 'staff' AND m.wa_message_id IS NULL AND m.delivery_status IS NULL
      AND m.content NOT LIKE '[Template sent%' AND m.content NOT LIKE '[24-hour%'
    GROUP BY c.tenant_id
  ) e ON e.tenant_id = t.id
  WHERE t.status = 'active'
    AND t.whatsapp_access_token_enc IS NOT NULL
    AND t.whatsapp_waba_id IS NOT NULL
    AND COALESCE(st.value, 'connected') NOT IN ('disconnected', 'offboarded')
    AND COALESCE(en.value, 'true') <> 'false'`

function errorClass(err) {
  return String((err && (err.name || err.code)) || 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40)
}

function istDate(ms) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function parseLast(text) {
  try {
    const parsed = JSON.parse(text)
    const refMs = Date.parse(parsed && parsed.ref)
    const atMs = Date.parse(parsed && parsed.at)
    return {
      refMs: Number.isFinite(refMs) ? refMs : null,
      count: Number.isInteger(parsed && parsed.count) ? parsed.count : 0,
      atMs: Number.isFinite(atMs) ? atMs : null
    }
  } catch (_) {
    return { refMs: null, count: 0, atMs: null }
  }
}

// Returns 'sent', 'skipped' or 'failed' for one clinic
async function remindClinic(row, nowMs) {
  if (!row.ref_time) return 'skipped'
  const refMs = new Date(row.ref_time).getTime()
  const days = (nowMs - refMs) / DAY_MS
  if (days < FIRST_REMINDER_DAYS) return 'skipped'

  const last = parseLast(row.last_reminder)
  // The clinic used the app or reconnected since the last reminder: start again from zero
  const count = last.refMs === refMs ? last.count : 0
  if (count >= 2) return 'skipped'
  if (count === 1 && days < SECOND_REMINDER_DAYS) return 'skipped'
  // Never more than one push per clinic per day
  if (last.atMs && istDate(last.atMs) === istDate(nowMs)) return 'skipped'

  const result = await sendPushToTenant(row.tenant_id, { title: PUSH_TITLE, body: PUSH_BODY, data: { type: 'wa_app_reminder' } })
  // No subscribed device: nothing to send, so the count does not advance
  if (!result || result.total === 0) return 'skipped'
  if (result.sent === 0) {
    logger.warn(`WA_APP_REMINDER tenant=${row.tenant_id} push=failed`)
    return 'failed'
  }
  await TenantService.setConfig(row.tenant_id, 'wa_app_reminder_last', JSON.stringify({
    ref: new Date(refMs).toISOString(),
    count: count + 1,
    at: new Date(nowMs).toISOString()
  }))
  return 'sent'
}

async function runWaAppReminder() {
  const nowMs = Date.now()
  // One run per IST day. Without Redis the run is skipped (fail closed). The lock simply expires.
  const lockToken = await acquireLockByKey(`wa_app_reminder:run:${istDate(nowMs)}`, RUN_LOCK_SECONDS)
  if (!lockToken) {
    logger.warn('WA_APP_REMINDER skipped: lock not acquired or Redis unavailable')
    return
  }
  const rows = (await pool.query(ELIGIBLE_SQL)).rows
  const totals = { sent: 0, skipped: 0, failed: 0 }
  for (const row of rows) {
    try {
      totals[await remindClinic(row, nowMs)]++
    } catch (err) {
      totals.failed++
      logger.warn(`WA_APP_REMINDER tenant=${row.tenant_id} class=${errorClass(err)}`)
    }
  }
  logger.info(`WA_APP_REMINDER eligible=${rows.length} sent=${totals.sent} skipped=${totals.skipped} failed=${totals.failed}`)
}

function startWaAppReminderCron() {
  cron.schedule('30 10 * * *', async () => {
    try {
      await runWaAppReminder()
    } catch (err) {
      logger.error(`WA_APP_REMINDER run failed class=${errorClass(err)}`)
    }
  }, { timezone: 'Asia/Kolkata' })
  logger.info('WhatsApp app reminder cron started (daily at 10:30 AM IST)')
}

module.exports = { startWaAppReminderCron, runWaAppReminder, ELIGIBLE_SQL }

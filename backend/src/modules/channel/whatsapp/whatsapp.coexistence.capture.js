const pool = require('../../../config/database')
const logger = require('../../../utils/logger')

// Capture of the coexistence webhook fields (history, smb_app_state_sync, account_update).
// Logs the SHAPE of the payload only: keys, types, lengths and counts. Never message bodies, names,
// phone numbers, tokens or any raw payload. history and smb_app_state_sync stay log-only.
// account_update additionally records the clinic's connection state (tenant_configs wa_* keys) and alerts once per event.
// It never pauses or blocks any sending.

const MAX_DEPTH = 8
const MAX_SHAPE_CHARS = 4000

// String values that are safe and useful to keep as they are
const SAFE_STRING_KEYS = new Set(['field', 'event', 'reason', 'initiated_by', 'phase', 'chunk_order', 'progress', 'code', 'status', 'action', 'type', 'messaging_product'])
// Numeric values that are safe and useful to keep as they are
const SAFE_NUMBER_KEYS = new Set(['chunk_order', 'progress', 'phase', 'code'])
// Keys that hold phone numbers: only the length and whether there is a leading plus is logged
const PHONE_KEYS = new Set(['from', 'to', 'phone_number', 'display_phone_number', 'wa_id'])
// Keys that hold names or text: only the length is logged
const TEXT_KEYS = new Set(['full_name', 'first_name', 'body', 'text', 'caption', 'name', 'title', 'message', 'details'])

// Value that is safe to print as a short token (enumerated names such as event or reason)
function safeToken(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value !== 'string') return null
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(value) ? value : `string(len=${value.length})`
}

function describeLeaf(value, key, parentKey) {
  if (value === null) return 'null'
  if (typeof value === 'string') {
    const isThreadId = key === 'id' && parentKey === 'threads'
    if (PHONE_KEYS.has(key) || isThreadId) return `phone(len=${value.replace(/^\+/, '').length}, plus=${value.startsWith('+')})`
    if (TEXT_KEYS.has(key)) return `string(len=${value.length})`
    if (SAFE_STRING_KEYS.has(key)) return safeToken(value)
    return `string(len=${value.length})`
  }
  if (typeof value === 'number') return SAFE_NUMBER_KEYS.has(key) ? value : 'number'
  if (typeof value === 'boolean') return 'boolean'
  return typeof value
}

function shapeOf(value, key, parentKey, depth) {
  if (value === null || typeof value !== 'object') return describeLeaf(value, key, parentKey)
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? '[array: depth limit]' : '{object: depth limit}'
  if (Array.isArray(value)) {
    const out = { _array_len: value.length }
    if (value.length) out._first = shapeOf(value[0], key, key, depth + 1)
    return out
  }
  const out = {}
  for (const k of Object.keys(value)) out[k] = shapeOf(value[k], k, key, depth + 1)
  return out
}

function countOf(arr) {
  return Array.isArray(arr) ? arr.length : 0
}

function addTo(set, value) {
  if (value === undefined || value === null) return
  const token = safeToken(value)
  if (token !== null) set.add(token)
}

function buildCounts(field, value) {
  if (field === 'history') {
    const entries = Array.isArray(value?.history) ? value.history : []
    let threads = 0
    let messages = 0
    const phases = new Set()
    const chunkOrders = new Set()
    const progresses = new Set()
    const errorCodes = new Set()
    for (const item of entries) {
      addTo(phases, item?.metadata?.phase)
      addTo(chunkOrders, item?.metadata?.chunk_order)
      addTo(progresses, item?.metadata?.progress)
      if (Array.isArray(item?.errors)) item.errors.forEach(e => addTo(errorCodes, e?.code))
      const itemThreads = Array.isArray(item?.threads) ? item.threads : []
      threads += itemThreads.length
      for (const thread of itemThreads) messages += countOf(thread?.messages)
    }
    return {
      history_entries: entries.length,
      threads,
      messages,
      phase: [...phases],
      chunk_order: [...chunkOrders],
      progress: [...progresses],
      error_codes: [...errorCodes]
    }
  }
  if (field === 'smb_app_state_sync') {
    const items = Array.isArray(value?.state_sync) ? value.state_sync : []
    const actions = {}
    for (const item of items) {
      const action = safeToken(item?.action) ?? 'none'
      actions[action] = (actions[action] || 0) + 1
    }
    return { state_sync_items: items.length, actions }
  }
  if (field === 'account_update') {
    return {
      event: safeToken(value?.event),
      reason: safeToken(value?.disconnection_info?.reason),
      initiated_by: safeToken(value?.disconnection_info?.initiated_by)
    }
  }
  return {}
}

// Read-only tenant lookup: by phone number id first, then by WABA id (entry.id)
async function lookupTenant(phoneNumberId, wabaId) {
  if (phoneNumberId) {
    const byPhone = await pool.query(
      'SELECT id FROM tenants WHERE whatsapp_phone_number_id = $1 LIMIT 5',
      [String(phoneNumberId)]
    )
    if (byPhone.rows.length) return { tenantId: byPhone.rows[0].id, matched: byPhone.rows.length }
  }
  if (wabaId) {
    const byWaba = await pool.query(
      'SELECT id FROM tenants WHERE whatsapp_waba_id = $1 LIMIT 5',
      [String(wabaId)]
    )
    if (byWaba.rows.length) return { tenantId: byWaba.rows[0].id, matched: byWaba.rows.length }
  }
  return { tenantId: 'none', matched: 0 }
}

// account_update lookup: the clinic's WABA id from the payload (value.waba_info.waba_id) first, then phone number id, then entry.id.
// The first step with any match decides: exactly one tenant is a match, more than one is ambiguous (no tenant is returned).
async function lookupAccountUpdateTenant(phoneNumberId, payloadWabaId, entryId) {
  const steps = [
    ['SELECT id FROM tenants WHERE whatsapp_waba_id = $1 LIMIT 5', payloadWabaId],
    ['SELECT id FROM tenants WHERE whatsapp_phone_number_id = $1 LIMIT 5', phoneNumberId],
    ['SELECT id FROM tenants WHERE whatsapp_waba_id = $1 LIMIT 5', entryId]
  ]
  for (const [sql, param] of steps) {
    if (!param) continue
    const res = await pool.query(sql, [String(param)])
    if (res.rows.length === 1) return { tenantId: res.rows[0].id, matched: 1 }
    if (res.rows.length > 1) return { tenantId: 'none', matched: res.rows.length }
  }
  return { tenantId: 'none', matched: 0 }
}

const STATE_KEYS = ['wa_connection_state', 'wa_state_changed_at', 'wa_last_alert_event']
const ALERT_LOCK_SECONDS = 7 * 24 * 60 * 60
const EVENT_LABELS = {
  PARTNER_REMOVED: 'Disconnected',
  ACCOUNT_OFFBOARDED: 'Offboarded',
  ACCOUNT_RECONNECTED: 'Reconnected',
  PARTNER_ADDED: 'Reconnected'
}
const PUSH_INACTIVITY = 'Your WhatsApp Business app was not opened for about 14 days, so the ReceptionAI connection paused. Open the app and contact support to reconnect.'
const PUSH_REMOVED = 'Your WhatsApp connection with ReceptionAI was removed. Contact support to reconnect.'

// Enumerated names only (event, reason, initiated_by): anything else is dropped
function enumToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value) ? value : ''
}

// Event time in ms: entry.time (seconds, or ms) when present, else null
function eventTimeMs(entry) {
  const t = Number(entry?.time)
  if (!Number.isFinite(t) || t <= 0) return null
  return t < 1e12 ? t * 1000 : t
}

async function readStateKeys(tenantId) {
  const res = await pool.query('SELECT key, value FROM tenant_configs WHERE tenant_id = $1 AND key = ANY($2)', [tenantId, STATE_KEYS])
  return Object.fromEntries(res.rows.map(r => [r.key, r.value]))
}

// Once per event: the Redis lock AND the stored wa_last_alert_event must both be free. With Redis down only the stored key decides.
async function claimAlert(TenantService, tenantId, dedupeKey, stored) {
  if (stored.wa_last_alert_event === dedupeKey) return false
  try {
    const redis = require('../../../config/redis')
    const got = await redis.set(`wa_disc_alert:${tenantId}:${dedupeKey}`, '1', { NX: true, EX: ALERT_LOCK_SECONDS })
    if (got !== 'OK') return false
  } catch (_) {
    // Redis unavailable: the stored key above is the guard
  }
  await TenantService.setConfig(tenantId, 'wa_last_alert_event', dedupeKey)
  return true
}

async function alertSuperAdmins(tenantName, event, reason, initiatedBy, whenMs) {
  const { sendWhatsappConnectionEmail } = require('../../../utils/email')
  const admins = await pool.query(`SELECT email FROM staff WHERE role = 'super_admin' AND is_active = true AND email IS NOT NULL AND email <> ''`)
  const whenIst = new Date(whenMs).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST'
  let sent = 0
  for (const row of admins.rows) {
    if (await sendWhatsappConnectionEmail({ to: row.email, clinicName: tenantName, eventLabel: EVENT_LABELS[event], reason, initiatedBy, whenIst })) sent++
  }
  return { recipients: admins.rows.length, sent }
}

// Connection state and alerts for one matched clinic. Called inside try/catch by the caller: never affects the webhook.
async function handleConnectionEvent(entry, value, tenantId, wabaId) {
  const event = enumToken(value?.event)
  if (!EVENT_LABELS[event] && event !== 'ACCOUNT_OFFBOARDED') return // PARTNER_APP_UNINSTALLED and everything else: log only
  const TenantService = require('../../tenant/tenant.service')

  const reason = enumToken(value?.disconnection_info?.reason)
  const initiatedBy = enumToken(value?.disconnection_info?.initiated_by)
  const payloadMs = eventTimeMs(entry)
  const whenMs = payloadMs || Date.now()
  const stored = await readStateKeys(tenantId)
  const previous = stored.wa_connection_state || ''

  // A late, older event must not undo a newer state
  const lastChange = Date.parse(stored.wa_state_changed_at || '')
  if (payloadMs && Number.isFinite(lastChange) && payloadMs < lastChange) {
    logger.info(`COEXISTENCE_STATE tenant=${tenantId} event=${event} result=stale_ignored`)
    return
  }

  const newState = event === 'PARTNER_REMOVED' ? 'disconnected' : event === 'ACCOUNT_OFFBOARDED' ? 'offboarded' : 'connected'
  await TenantService.setConfig(tenantId, 'wa_connection_state', newState)
  await TenantService.setConfig(tenantId, 'wa_state_changed_at', new Date(whenMs).toISOString())
  if (newState !== 'connected') {
    await TenantService.setConfig(tenantId, 'wa_disconnect_reason', reason)
    await TenantService.setConfig(tenantId, 'wa_disconnect_initiated_by', initiatedBy)
  }
  logger.info(`COEXISTENCE_STATE tenant=${tenantId} event=${event} state=${newState} previous=${previous || 'none'}`)

  // Alerts: a disconnect, an offboarding, or a reconnect that follows one
  const alertable = newState !== 'connected' || previous === 'disconnected' || previous === 'offboarded'
  if (!alertable) return
  const dedupeKey = `${wabaId}:${event}:${payloadMs ? Math.floor(payloadMs / 1000) : `n${Math.floor(Date.now() / 600000)}`}`
  if (!(await claimAlert(TenantService, tenantId, dedupeKey, stored))) {
    logger.info(`COEXISTENCE_ALERT tenant=${tenantId} event=${event} result=already_alerted`)
    return
  }

  const tenantRow = (await pool.query('SELECT name, status FROM tenants WHERE id = $1', [tenantId])).rows[0]
  if (!tenantRow) return
  try {
    const mail = await alertSuperAdmins(tenantRow.name, event, reason, initiatedBy, whenMs)
    logger.info(`COEXISTENCE_ALERT tenant=${tenantId} event=${event} email_recipients=${mail.recipients} email_sent=${mail.sent}`)
  } catch (mailErr) {
    logger.warn(`COEXISTENCE_ALERT tenant=${tenantId} event=${event} email=failed`)
  }
  if (event === 'PARTNER_REMOVED' && tenantRow.status === 'active') {
    try {
      const { sendPushToTenant } = require('../../push/push.service')
      await sendPushToTenant(tenantId, {
        title: 'WhatsApp connection',
        body: reason === 'PRIMARY_INACTIVITY' ? PUSH_INACTIVITY : PUSH_REMOVED,
        data: { type: 'wa_disconnected' }
      })
      logger.info(`COEXISTENCE_ALERT tenant=${tenantId} event=${event} push=sent`)
    } catch (pushErr) {
      logger.warn(`COEXISTENCE_ALERT tenant=${tenantId} event=${event} push=failed`)
    }
  }
}

/**
 * Logs the shape of a history, smb_app_state_sync or account_update webhook change. Never throws.
 * @param {object} entry - entry[] item of the webhook body
 * @param {object} change - entry.changes[] item
 */
async function captureCoexistenceEvent(entry, change) {
  try {
    const field = safeToken(change?.field) || 'unknown'
    const value = change?.value
    const phoneNumberId = value?.metadata?.phone_number_id
    const wabaId = entry?.id

    let tenantId = 'none'
    let matched = 0
    try {
      ({ tenantId, matched } = field === 'account_update'
        ? await lookupAccountUpdateTenant(phoneNumberId, value?.waba_info?.waba_id, wabaId)
        : await lookupTenant(phoneNumberId, wabaId))
    } catch (lookupErr) {
      logger.warn(`COEXISTENCE_CAPTURE field=${field} tenant_lookup=failed`)
    }

    const shape = JSON.stringify(shapeOf(value, 'value', null, 0)).slice(0, MAX_SHAPE_CHARS)
    const entryIdLog = wabaId ? safeToken(String(wabaId)) : 'none'
    const phoneIdLog = phoneNumberId ? safeToken(String(phoneNumberId)) : 'none'
    logger.info(`COEXISTENCE_CAPTURE field=${field} entry_id=${entryIdLog} phone_number_id=${phoneIdLog} tenant=${tenantId} tenants_matched=${matched} shape=${shape}`)

    const counts = JSON.stringify(buildCounts(field, value)).slice(0, MAX_SHAPE_CHARS)
    logger.info(`COEXISTENCE_CAPTURE field=${field} tenant=${tenantId} counts=${counts}`)

    if (field === 'account_update') {
      const payloadWaba = value?.waba_info?.waba_id ? String(value.waba_info.waba_id) : (wabaId ? String(wabaId) : '')
      if (matched !== 1 || tenantId === 'none') {
        // Nothing is changed for a clinic we cannot identify exactly
        logger.warn(`COEXISTENCE_UNMATCHED event=${safeToken(value?.event) || 'none'} waba_id=${payloadWaba ? safeToken(payloadWaba) : 'none'}`)
      } else {
        try {
          await handleConnectionEvent(entry, value, tenantId, payloadWaba)
        } catch (stateErr) {
          logger.warn(`COEXISTENCE_STATE tenant=${tenantId} failed (ignored)`)
        }
      }
    }
  } catch (err) {
    try {
      logger.warn('COEXISTENCE_CAPTURE failed (ignored)')
    } catch {}
  }
}

module.exports = { captureCoexistenceEvent }

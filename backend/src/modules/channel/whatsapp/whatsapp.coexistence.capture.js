const pool = require('../../../config/database')
const logger = require('../../../utils/logger')

// Log-only capture of the coexistence webhook fields (history, smb_app_state_sync, account_update).
// Logs the SHAPE of the payload only: keys, types, lengths and counts. Never message bodies, names,
// phone numbers, tokens or any raw payload. No database writes, no Redis, no SSE, no AI.

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
      ({ tenantId, matched } = await lookupTenant(phoneNumberId, wabaId))
    } catch (lookupErr) {
      logger.warn(`COEXISTENCE_CAPTURE field=${field} tenant_lookup=failed`)
    }

    const shape = JSON.stringify(shapeOf(value, 'value', null, 0)).slice(0, MAX_SHAPE_CHARS)
    const entryIdLog = wabaId ? safeToken(String(wabaId)) : 'none'
    const phoneIdLog = phoneNumberId ? safeToken(String(phoneNumberId)) : 'none'
    logger.info(`COEXISTENCE_CAPTURE field=${field} entry_id=${entryIdLog} phone_number_id=${phoneIdLog} tenant=${tenantId} tenants_matched=${matched} shape=${shape}`)

    const counts = JSON.stringify(buildCounts(field, value)).slice(0, MAX_SHAPE_CHARS)
    logger.info(`COEXISTENCE_CAPTURE field=${field} tenant=${tenantId} counts=${counts}`)
  } catch (err) {
    try {
      logger.warn('COEXISTENCE_CAPTURE failed (ignored)')
    } catch {}
  }
}

module.exports = { captureCoexistenceEvent }

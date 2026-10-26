const { AsyncLocalStorage } = require('async_hooks')
const pool = require('../../../config/database')
const logger = require('../../../utils/logger')
const { decrypt } = require('../../../utils/secretBox')

const storage = new AsyncLocalStorage()
const PHONE_NUMBER_ID_PATTERN = /^\d{8,20}$/

// The clinic's encrypted token and its platform_token_allowed flag are read together and cached per tenant for a short time,
// so a message does not add a database query each time (a changed flag applies within a minute)
const TOKEN_CACHE_MS = 60 * 1000
const tokenCache = new Map()
const lastWarned = new Map() // one warning per tenant and kind per minute, so a database outage does not flood the log

// Why a send has no own token: 'ok' (it has one), 'no_token' (the clinic has none), 'lookup_failed', 'decrypt_failed', or
// 'no_tenant' (a context that does not belong to a clinic yet)
const NO_AUTH = { token: null, platformTokenAllowed: false, state: 'no_tenant' }

const errorClass = (err) => String((err && (err.name || err.code)) || 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40)

function warnOnce(kind, tenantId, text) {
  const key = `${kind}:${tenantId}`
  const last = lastWarned.get(key)
  if (last && Date.now() - last < TOKEN_CACHE_MS) return
  lastWarned.set(key, Date.now())
  logger.warn(text)
}

// Optional accessToken: a tenant's own Meta token; null means the clinic has none
// Optional tenantId: used to label failed sends in logs and in the send_failures table
// Optional auth: { platformTokenAllowed, state } - whether the clinic may fall back to the shared platform token, and why it has no own token
function run(phoneNumberId, fn, accessToken = null, tenantId = null, auth = NO_AUTH) {
  const value = phoneNumberId == null ? '' : String(phoneNumberId)
  const validated = PHONE_NUMBER_ID_PATTERN.test(value) ? value : null
  if (value && !validated) {
    logger.warn(`[senderContext] run() received non-empty but invalid phoneNumberId: ${value}`)
  }
  return storage.run({
    phoneNumberId: validated,
    accessToken: accessToken || null,
    tenantId: tenantId || null,
    platformTokenAllowed: auth.platformTokenAllowed === true,
    tokenState: auth.state || 'no_tenant',
    timing: null,
    replyFast: false // true only inside the webhook's processing of a patient's inbound message (see startReplyTiming)
  }, fn)
}

// Reply timing for ONE inbound WhatsApp message (only the webhook starts it; every other context has none and the calls below do nothing).
// startReplyTiming() when processing begins, addAiTime(ms) around the AI call, noteReplySent(kind, sendMs) when a reply has gone out
// (the first one counts), getReplyTiming() when processing is over. Nothing here holds a phone number or message text.
// It also marks the context as "reply fast": text sent while the webhook processes a patient's message waits 0.3-0.7 s before sending
// instead of 0.8-1.5 s (whatsapp.adapter.js). This is the ONLY place that sets the flag; the webhook is the only caller, and every other
// context (crons, staff replies, the retry cron, confirmations) is created without it, so those keep the longer pause.
function startReplyTiming() {
  const store = storage.getStore()
  if (store) {
    store.timing = { start: Date.now(), aiMs: 0, reply: null }
    store.replyFast = true
  }
}

function isReplyFast() {
  return storage.getStore()?.replyFast === true
}

function addAiTime(ms) {
  const timing = storage.getStore()?.timing
  if (timing && Number.isFinite(ms)) timing.aiMs += ms
}

function noteReplySent(kind, sendMs) {
  const timing = storage.getStore()?.timing
  if (timing && !timing.reply) timing.reply = { kind, totalMs: Date.now() - timing.start, sendMs }
}

function getReplyTiming() {
  return storage.getStore()?.timing || null
}

// What the AI used for this inbound message, for the REPLY_TIMING log line: a short hash of the final system prompt (never the prompt
// text), the plan, whether the guided clinic information was on, and the model of the attempt. Set by ai.service.js at the start of
// each attempt (the last one wins); there is nothing here when the AI was not used.
function setAiTrace(trace) {
  const store = storage.getStore()
  if (store) store.aiTrace = trace
}

function getAiTrace() {
  return storage.getStore()?.aiTrace || null
}

// " ph=1a2b3c4d plan=pro guided=on model=gemini-2.5-flash" (empty when there is no trace). Only these four short fields are ever printed.
function formatAiTrace(trace) {
  if (!trace) return ''
  const clean = (value) => String(value == null ? 'unknown' : value).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40) || 'unknown'
  return ` ph=${clean(trace.ph)} plan=${clean(trace.plan)} guided=${trace.guided ? 'on' : 'off'} model=${clean(trace.model)}`
}

function getTenantId() {
  return storage.getStore()?.tenantId || null
}

function getPhoneNumberId() {
  return storage.getStore()?.phoneNumberId || null
}

function getAccessToken() {
  return storage.getStore()?.accessToken || null
}

// True only for a clinic whose tenant_configs value platform_token_allowed is exactly 'true' (set by a super admin)
function getPlatformTokenAllowed() {
  return storage.getStore()?.platformTokenAllowed === true
}

function getTokenState() {
  return storage.getStore()?.tokenState || 'no_tenant'
}

// Turns what was read for a clinic into { token, platformTokenAllowed, state }. A decrypt failure is recorded, never silent.
function openToken(tenantId, enc, allowedValue) {
  const platformTokenAllowed = allowedValue === 'true'
  if (!enc) return { token: null, platformTokenAllowed, state: 'no_token' }
  try {
    return { token: decrypt(enc), platformTokenAllowed, state: 'ok' }
  } catch (err) {
    warnOnce('decrypt', tenantId, `TENANT_TOKEN_DECRYPT_FAILED tenant=${tenantId} class=${errorClass(err)}`)
    return { token: null, platformTokenAllowed, state: 'decrypt_failed' }
  }
}

// The clinic's decrypted Meta token and its platform-token flag. Nothing here logs the token or the ciphertext.
// A failed lookup is logged (tenant id and error class only); the last values read for the clinic are used if there are any,
// otherwise the clinic has no token and no right to the platform token for this send.
async function resolveTenantAuth(tenantId) {
  if (!tenantId) return NO_AUTH
  const cached = tokenCache.get(tenantId)
  if (cached && Date.now() - cached.at < TOKEN_CACHE_MS) {
    return openToken(tenantId, cached.enc, cached.allowed)
  }
  try {
    const result = await pool.query(
      `SELECT t.whatsapp_access_token_enc AS enc,
              (SELECT c.value FROM tenant_configs c WHERE c.tenant_id = t.id AND c.key = 'platform_token_allowed') AS allowed
       FROM tenants t WHERE t.id = $1`,
      [tenantId]
    )
    const row = result.rows[0]
    const entry = { enc: row?.enc || null, allowed: row?.allowed || null, at: Date.now() }
    tokenCache.set(tenantId, entry)
    return openToken(tenantId, entry.enc, entry.allowed)
  } catch (err) {
    warnOnce('lookup', tenantId, `TENANT_TOKEN_LOOKUP_FAILED tenant=${tenantId} class=${errorClass(err)}`)
    if (cached) return openToken(tenantId, cached.enc, cached.allowed)
    return { token: null, platformTokenAllowed: false, state: 'lookup_failed' }
  }
}

// Forgets the cached token and platform-token flag of one clinic (or of every clinic when no id is given), so a changed flag, a new
// connection or a removed token applies at once instead of after up to a minute. The cache stores the same things as before.
function clearTenantTokenCache(tenantId) {
  if (tenantId) tokenCache.delete(tenantId)
  else tokenCache.clear()
}

// Adds the tenant's token to the context that is already active (used by the webhook, where the tenant is found after run())
async function setTenantAccessToken(tenantId) {
  const store = storage.getStore()
  if (!store) return
  const auth = await resolveTenantAuth(tenantId)
  store.tenantId = tenantId || null
  store.accessToken = auth.token
  store.platformTokenAllowed = auth.platformTokenAllowed
  store.tokenState = auth.state
}

function hasContext() {
  return !!storage.getStore()
}

async function runAsTenant(tenantId, fn) {
  let phoneNumberId = null
  try {
    if (tenantId) {
      const result = await pool.query(
        'SELECT whatsapp_phone_number_id FROM tenants WHERE id = $1',
        [tenantId]
      )
      phoneNumberId = result.rows[0]?.whatsapp_phone_number_id || null
    }
    if (phoneNumberId && !PHONE_NUMBER_ID_PATTERN.test(String(phoneNumberId))) {
      logger.warn(`[senderContext] Tenant ${tenantId} has a stored ID that failed validation: ${phoneNumberId}`)
    } else if (!phoneNumberId) {
      logger.warn(`[senderContext] Tenant ${tenantId} has no valid whatsapp_phone_number_id; context will have null ID`)
    }
  } catch (err) {
    logger.error(`Phone number ID lookup failed for tenant ${tenantId}:`, err.message)
    phoneNumberId = null
  }
  const auth = await resolveTenantAuth(tenantId)
  return run(phoneNumberId, fn, auth.token, tenantId, auth)
}

module.exports = {
  run,
  getPhoneNumberId,
  getTenantId,
  getAccessToken,
  getPlatformTokenAllowed,
  getTokenState,
  setTenantAccessToken,
  clearTenantTokenCache,
  startReplyTiming,
  isReplyFast,
  addAiTime,
  noteReplySent,
  getReplyTiming,
  setAiTrace,
  getAiTrace,
  formatAiTrace,
  runAsTenant,
  hasContext
}

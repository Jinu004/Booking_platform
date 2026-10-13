const { AsyncLocalStorage } = require('async_hooks')
const pool = require('../../../config/database')
const logger = require('../../../utils/logger')
const { decrypt } = require('../../../utils/secretBox')

const storage = new AsyncLocalStorage()
const PHONE_NUMBER_ID_PATTERN = /^\d{8,20}$/

// The encrypted token is cached per tenant for a short time so a message does not add a database query each time
const TOKEN_CACHE_MS = 60 * 1000
const tokenCache = new Map()
let tokenLookupWarned = false

// Optional accessToken: a tenant's own Meta token; null means the shared env token is used
function run(phoneNumberId, fn, accessToken = null) {
  const value = phoneNumberId == null ? '' : String(phoneNumberId)
  const validated = PHONE_NUMBER_ID_PATTERN.test(value) ? value : null
  if (value && !validated) {
    logger.warn(`[senderContext] run() received non-empty but invalid phoneNumberId: ${value}`)
  }
  return storage.run({ phoneNumberId: validated, accessToken: accessToken || null }, fn)
}

function getPhoneNumberId() {
  return storage.getStore()?.phoneNumberId || null
}

function getAccessToken() {
  return storage.getStore()?.accessToken || null
}

// Returns the tenant's decrypted Meta token, or null (no token, column not migrated yet, or decryption failed).
// Nothing here logs the token or the ciphertext.
async function resolveTenantToken(tenantId) {
  if (!tenantId) return null
  let enc = null
  const cached = tokenCache.get(tenantId)
  if (cached && Date.now() - cached.at < TOKEN_CACHE_MS) {
    enc = cached.enc
  } else {
    try {
      const result = await pool.query('SELECT whatsapp_access_token_enc FROM tenants WHERE id = $1', [tenantId])
      enc = result.rows[0]?.whatsapp_access_token_enc || null
      tokenCache.set(tenantId, { enc, at: Date.now() })
    } catch (err) {
      if (!tokenLookupWarned) {
        tokenLookupWarned = true
        logger.warn(`[senderContext] Tenant token lookup failed, using the shared token: ${err.message}`)
      }
      return null
    }
  }
  if (!enc) return null
  try {
    return decrypt(enc)
  } catch (err) {
    logger.warn(`[senderContext] Tenant ${tenantId} token could not be decrypted, using the shared token`)
    return null
  }
}

// Adds the tenant's token to the context that is already active (used by the webhook, where the tenant is found after run())
async function setTenantAccessToken(tenantId) {
  const store = storage.getStore()
  if (!store) return
  store.accessToken = await resolveTenantToken(tenantId)
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
  const tenantToken = await resolveTenantToken(tenantId)
  return run(phoneNumberId, fn, tenantToken)
}

module.exports = {
  run,
  getPhoneNumberId,
  getAccessToken,
  setTenantAccessToken,
  runAsTenant,
  hasContext
}

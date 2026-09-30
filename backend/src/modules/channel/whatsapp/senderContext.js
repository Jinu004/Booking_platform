const { AsyncLocalStorage } = require('async_hooks')
const pool = require('../../../config/database')
const logger = require('../../../utils/logger')

const storage = new AsyncLocalStorage()
const PHONE_NUMBER_ID_PATTERN = /^\d{8,20}$/

function run(phoneNumberId, fn) {
  const value = phoneNumberId == null ? '' : String(phoneNumberId)
  const validated = PHONE_NUMBER_ID_PATTERN.test(value) ? value : null
  if (value && !validated) {
    logger.warn(`[senderContext] run() received non-empty but invalid phoneNumberId: ${value}`)
  }
  return storage.run({ phoneNumberId: validated }, fn)
}

function getPhoneNumberId() {
  return storage.getStore()?.phoneNumberId || null
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
  return run(phoneNumberId, fn)
}

module.exports = {
  run,
  getPhoneNumberId,
  runAsTenant,
  hasContext
}

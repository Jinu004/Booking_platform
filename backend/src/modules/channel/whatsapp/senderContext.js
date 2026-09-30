const { AsyncLocalStorage } = require('async_hooks')
const pool = require('../../../config/database')
const logger = require('../../../utils/logger')

const storage = new AsyncLocalStorage()
const PHONE_NUMBER_ID_PATTERN = /^\d{8,20}$/

function run(phoneNumberId, fn) {
  const value = phoneNumberId == null ? '' : String(phoneNumberId)
  const validated = PHONE_NUMBER_ID_PATTERN.test(value) ? value : null
  return storage.run({ phoneNumberId: validated }, fn)
}

function getPhoneNumberId() {
  return storage.getStore()?.phoneNumberId || null
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
    if (!phoneNumberId) {
      logger.warn(`Tenant ${tenantId} has no whatsapp_phone_number_id, sending from the default number`)
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
  runAsTenant
}

const { AsyncLocalStorage } = require('async_hooks')

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

module.exports = {
  run,
  getPhoneNumberId
}

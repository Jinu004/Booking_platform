const crypto = require('crypto')

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12

// The key is read only when encrypt/decrypt is called, never at require/startup time.
function getKey() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('TOKEN_ENCRYPTION_KEY is missing or invalid (expected 64 hex characters)')
  }
  return Buffer.from(hex, 'hex')
}

/**
 * Encrypts text with AES-256-GCM and a random IV.
 * @param {string} text
 * @returns {string} "iv:tag:ciphertext", each part base64
 */
function encrypt(text) {
  const key = getKey()
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`
}

/**
 * Decrypts a string made by encrypt(). Errors never contain the payload or the plaintext.
 * @param {string} payload "iv:tag:ciphertext"
 * @returns {string}
 */
function decrypt(payload) {
  const key = getKey()
  const parts = typeof payload === 'string' ? payload.split(':') : []
  if (parts.length !== 3) throw new Error('Invalid encrypted secret format')
  try {
    const iv = Buffer.from(parts[0], 'base64')
    const tag = Buffer.from(parts[1], 'base64')
    const ciphertext = Buffer.from(parts[2], 'base64')
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch (err) {
    throw new Error('Could not decrypt secret (wrong key or corrupted data)')
  }
}

// Removes secret tenant columns from a tenant row before it is returned, cached or logged
function omitTenantSecrets(row) {
  if (row && typeof row === 'object' && 'whatsapp_access_token_enc' in row) {
    delete row.whatsapp_access_token_enc
  }
  return row
}

module.exports = { encrypt, decrypt, omitTenantSecrets }

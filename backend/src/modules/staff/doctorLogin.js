const crypto = require('crypto')
const StaffModel = require('./staff.model')
const { bcrypt } = require('../../config/auth')

// Shared by the doctor create / update / delete handlers: the doctor's staff login is made from the doctor profile's email.
const EMAIL_TAKEN_MESSAGE = 'This email is already used by another account. Use a different email address.'
const EMAIL_INVALID_MESSAGE = 'Enter a valid email address'

// The same email format check the staff invite uses
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

// Reads the optional email of a request: { given: false } when it is missing or empty, otherwise the trimmed, lower-cased text
function readEmail(value) {
  if (value === undefined || value === null || String(value).trim() === '') return { given: false, email: '' }
  return { given: true, email: String(value).trim().toLowerCase() }
}

// A temporary password made and hashed the way the staff invite does it: 12 random bytes as base64url, bcrypt with 12 rounds.
// Hashing is slow, so callers do it before they open a transaction.
async function makeTempPassword() {
  const password = crypto.randomBytes(12).toString('base64url')
  const hash = await bcrypt.hash(password, 12)
  return { password, hash }
}

// Inside a transaction: waits for any other transaction that is working with the same email (staff.email has no unique index)
async function lockEmail(client, email) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['staff_email:' + email])
}

// Inserts the staff login of a doctor on the given client (name and phone from the doctor, role doctor, linked to the doctor)
async function insertDoctorLogin(client, tenantId, doctor, email, passwordHash) {
  return StaffModel.createStaff(client, tenantId, {
    name: doctor.name,
    role: 'doctor',
    email,
    phone: doctor.phone,
    password_hash: passwordHash,
    doctor_id: doctor.id
  })
}

module.exports = {
  EMAIL_TAKEN_MESSAGE,
  EMAIL_INVALID_MESSAGE,
  isValidEmail,
  readEmail,
  makeTempPassword,
  lockEmail,
  insertDoctorLogin
}

const pool = require('../config/database')
const { errorResponse } = require('./response')

// Shared rules for the doctor role. A user with role 'doctor' only reaches data tied to their own doctor (staff.doctor_id).
// Every other role is never touched by these helpers.
//   - A doctor with no doctor link is answered 403.
//   - A single record that is not theirs is answered 404 (the same answer as an unknown id), so it does not reveal that it exists.
const NOT_LINKED_MESSAGE = 'Your account is not linked to a doctor profile'

const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(str))
const isDoctor = (req) => req.staff?.role === 'doctor'

// True when the request may go on: any role other than doctor, or a doctor who has a doctor link.
// An unlinked doctor is answered with 403 here, and false is returned.
function doctorLinkOk(req, res) {
  if (isDoctor(req) && !req.staff.doctor_id) {
    errorResponse(res, NOT_LINKED_MESSAGE, 403)
    return false
  }
  return true
}

// Express middleware form of doctorLinkOk
function requireDoctorLink(req, res, next) {
  if (!doctorLinkOk(req, res)) return
  next()
}

// The doctor id to filter by: the doctor's own for the doctor role, null for every other role. Call doctorLinkOk first.
function ownDoctorId(req) {
  return isDoctor(req) ? req.staff.doctor_id : null
}

// One booking by id. Other roles: always true. A doctor: only a booking of their own doctor, otherwise 404 (false is returned).
async function bookingAllowed(req, res, bookingId) {
  if (!isDoctor(req)) return true
  if (!doctorLinkOk(req, res)) return false
  if (isUUID(bookingId)) {
    const result = await pool.query(
      'SELECT 1 FROM bookings WHERE id = $1 AND tenant_id = $2 AND doctor_id = $3',
      [bookingId, req.tenantId, req.staff.doctor_id]
    )
    if (result.rows.length) return true
  }
  errorResponse(res, 'Booking not found', 404)
  return false
}

// One customer by id (customers.id). Other roles: always true. A doctor: only a customer with at least one booking
// (same clinic) with their own doctor, otherwise 404.
async function customerAllowed(req, res, customerId) {
  if (!isDoctor(req)) return true
  if (!doctorLinkOk(req, res)) return false
  if (isUUID(customerId)) {
    const result = await pool.query(
      'SELECT 1 FROM bookings WHERE tenant_id = $1 AND customer_id = $2 AND doctor_id = $3 LIMIT 1',
      [req.tenantId, customerId, req.staff.doctor_id]
    )
    if (result.rows.length) return true
  }
  errorResponse(res, 'Customer not found', 404)
  return false
}

// One patient record. The id in the URL may be a patient id or a customer id (as in GET /ehr/patients/:patientId).
// Other roles: always true. A doctor: only when a booking of the same clinic with their own doctor matches the patient:
// a booking with that patient_id, a booking of that customer_id, or a booking with no patient_id of the patient's customer.
// Otherwise 404.
async function patientAllowed(req, res, rawId) {
  if (!isDoctor(req)) return true
  if (!doctorLinkOk(req, res)) return false
  if (isUUID(rawId)) {
    const result = await pool.query(
      `SELECT 1 FROM bookings b
       WHERE b.tenant_id = $2 AND b.doctor_id = $3
         AND (
           b.patient_id = $1
           OR b.customer_id = $1
           OR (b.patient_id IS NULL AND b.customer_id = (SELECT customer_id FROM patients WHERE id = $1 AND tenant_id = $2))
         )
       LIMIT 1`,
      [rawId, req.tenantId, req.staff.doctor_id]
    )
    if (result.rows.length) return true
  }
  errorResponse(res, 'Patient not found', 404)
  return false
}

module.exports = {
  NOT_LINKED_MESSAGE,
  doctorLinkOk,
  requireDoctorLink,
  ownDoctorId,
  bookingAllowed,
  customerAllowed,
  patientAllowed
}

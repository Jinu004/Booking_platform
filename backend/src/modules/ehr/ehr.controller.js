const pool = require('../../config/database');
const { successResponse, errorResponse } = require('../../utils/response');
const logger = require('../../utils/logger');
const { normalizeCustomerPhone } = require('../../utils/phone');
const { logAction } = require('../../utils/audit');

// HTML tag stripper — prevents stored XSS in free-text fields
const stripHtml = (str) => str ? str.replace(/<[^>]*>/g, '').trim() : str;

// UUID v4 format validation helper
const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

function isPro(req) {
  return req.tenant?.plan === 'pro';
}

// GET /ehr/patients -- list all patients with profile summary
async function getPatients(req, res, next) {
  if (!isPro(req)) return errorResponse(res, 'EHR is a Pro plan feature', 403);
  try {
    const { search, consent } = req.query;
    // Consent belongs to the phone number (customers), so patients who share a phone share the value
    let query = `
      SELECT p.id, p.name, p.phone, p.age, p.gender, p.blood_group, p.created_at,
             MAX(b.booking_date) as last_visit,
             COUNT(DISTINCT b.id) as total_visits,
             cu.marketing_consent, cu.consent_source, cu.consent_at
      FROM patients p
      LEFT JOIN customers cu ON cu.id = p.customer_id AND cu.tenant_id = p.tenant_id
      LEFT JOIN bookings b ON b.patient_id = p.id AND b.tenant_id = p.tenant_id AND b.status = 'completed'
      WHERE p.tenant_id = $1
    `;
    const params = [req.tenantId];
    if (search) {
      query += ` AND (p.name ILIKE $2 OR p.phone ILIKE $2)`;
      params.push(`%${search}%`);
    }
    // Optional consent filter (an invalid value is ignored): all, checkups, none, or not_asked (never asked)
    if (consent === 'not_asked') {
      query += ` AND cu.marketing_consent IS NULL`;
    } else if (['all', 'checkups', 'none'].includes(consent)) {
      params.push(consent);
      query += ` AND cu.marketing_consent = $${params.length}`;
    }
    // Doctors only see patients who have had a booking with them
    if (req.staff.role === 'doctor' && req.staff.doctor_id) {
      const nextParam = params.length + 1;
      query += ` AND p.id IN (
        SELECT DISTINCT patient_id FROM bookings
        WHERE tenant_id = $1 AND doctor_id = $${nextParam} AND patient_id IS NOT NULL
      )`;
      params.push(req.staff.doctor_id);
    }
    query += ` GROUP BY p.id, cu.id ORDER BY last_visit DESC NULLS LAST, p.created_at DESC`;
    const result = await pool.query(query, params);
    return successResponse(res, { customers: result.rows, total: result.rows.length });
  } catch (err) {
    next(err);
  }
}

// GET /ehr/patients/consent-summary -- how many patients have each marketing consent value.
// Counts patient rows (the unit the patient list shows), with the same doctor restriction as the list.
async function getConsentSummary(req, res, next) {
  if (!isPro(req)) return errorResponse(res, 'EHR is a Pro plan feature', 403);
  try {
    let query = `
      SELECT
        COUNT(*) FILTER (WHERE cu.marketing_consent = 'all')::int AS all_count,
        COUNT(*) FILTER (WHERE cu.marketing_consent = 'checkups')::int AS checkups_count,
        COUNT(*) FILTER (WHERE cu.marketing_consent = 'none')::int AS none_count,
        COUNT(*) FILTER (WHERE cu.marketing_consent IS NULL)::int AS not_asked_count,
        COUNT(*)::int AS total_count
      FROM patients p
      LEFT JOIN customers cu ON cu.id = p.customer_id AND cu.tenant_id = p.tenant_id
      WHERE p.tenant_id = $1
    `;
    const params = [req.tenantId];
    if (req.staff.role === 'doctor' && req.staff.doctor_id) {
      query += ` AND p.id IN (
        SELECT DISTINCT patient_id FROM bookings
        WHERE tenant_id = $1 AND doctor_id = $2 AND patient_id IS NOT NULL
      )`;
      params.push(req.staff.doctor_id);
    }
    const row = (await pool.query(query, params)).rows[0];
    return successResponse(res, {
      all: row.all_count,
      checkups: row.checkups_count,
      none: row.none_count,
      not_asked: row.not_asked_count,
      total: row.total_count
    });
  } catch (err) {
    next(err);
  }
}

// The full patient profile (used by GET /ehr/patients/:patientId and returned by PATCH). Returns null when not found.
async function loadPatientProfile(rawId, tenantId) {
    // Resolve real patient.id — accepts either patient.id or customer_id
    const patientRes = await pool.query(
      `SELECT * FROM patients WHERE (id = $1 OR customer_id = $1) AND tenant_id = $2 ORDER BY created_at ASC LIMIT 1`,
      [rawId, tenantId]
    );
    if (!patientRes.rows.length) return null;
    const patientId = patientRes.rows[0].id;
    const customerIdForBookings = patientRes.rows[0].customer_id || rawId;
    const [conditionsRes, visitNotesRes, bookingsRes] = await Promise.all([
      pool.query(`SELECT * FROM patient_conditions WHERE patient_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`, [patientId, tenantId]),
      pool.query(`
        SELECT vn.*, d.name as doctor_name, d.specialization as doctor_specialization
        FROM visit_notes vn
        LEFT JOIN clinic_doctors d ON d.id = vn.doctor_id
        WHERE vn.patient_id = $1 AND vn.tenant_id = $2
        ORDER BY vn.visit_date DESC
      `, [patientId, tenantId]),
      pool.query(`
        SELECT b.*, d.name as doctor_name,
               (SELECT ds.start_time FROM doctor_schedules ds
                WHERE ds.doctor_id = b.doctor_id
                AND ds.day_of_week = EXTRACT(DOW FROM b.booking_date)::integer
                AND ds.tenant_id = b.tenant_id
                AND ds.is_available = true
                ORDER BY ds.start_time ASC LIMIT 1) as session_start_time
        FROM bookings b
        LEFT JOIN clinic_doctors d ON d.id = b.doctor_id
        WHERE (b.patient_id = $1 OR b.customer_id = $2) AND b.tenant_id = $3
        ORDER BY b.booking_date DESC
      `, [patientId, customerIdForBookings, tenantId])
    ]);
    const patientRow = patientRes.rows[0];
    // Marketing consent lives on the customer (phone number)
    const consentRes = await pool.query(
      `SELECT marketing_consent, consent_source, consent_at FROM customers WHERE id = $1 AND tenant_id = $2`,
      [patientRow.customer_id, tenantId]
    );
    const consentRow = consentRes.rows[0] || {};
    return {
      customer: {
        ...patientRow,
        marketing_consent: consentRow.marketing_consent ?? null,
        consent_source: consentRow.consent_source ?? null,
        consent_at: consentRow.consent_at ?? null
      },
      profile: {
        age: patientRow.age,
        gender: patientRow.gender,
        blood_group: patientRow.blood_group,
        emergency_contact_name: patientRow.emergency_contact_name,
        emergency_contact_phone: patientRow.emergency_contact_phone,
        emergency_contact_relationship: patientRow.emergency_contact_relationship
      },
      conditions: conditionsRes.rows,
      visitNotes: visitNotesRes.rows,
      bookings: bookingsRes.rows
    };
}

// GET /ehr/patients/:patientId -- full patient profile
async function getPatient(req, res, next) {
  if (!isPro(req)) return errorResponse(res, 'EHR is a Pro plan feature', 403);
  try {
    const rawId = req.params.patientId || req.params.customerId;
    if (!isUUID(rawId)) return errorResponse(res, 'Invalid patient ID', 400);
    const profile = await loadPatientProfile(rawId, req.tenantId);
    if (!profile) return errorResponse(res, 'Patient not found', 404);
    return successResponse(res, profile);
  } catch (err) {
    next(err);
  }
}

// POST /ehr/patients -- manually create a new patient record
async function createPatient(req, res) {
  const tenantId = req.tenantId;
  const { name, phone, age, gender, blood_group } = req.body;

  // Normalize phone to +91XXXXXXXXXX format
  const normalizedPhone = (() => {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
    if (digits.length === 13 && digits.startsWith('91')) return `+${digits.slice(1)}`;
    return `+${digits}`;
  })();

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Patient name is required' });
  }
  if (!phone || !phone.trim()) {
    return res.status(400).json({ success: false, error: 'Phone number is required' });
  }

  try {
    // Find or create customer record
    let customerId;
    const existingCustomer = await pool.query(
      `SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2 LIMIT 1`,
      [tenantId, normalizedPhone]
    );
    if (existingCustomer.rows.length > 0) {
      customerId = existingCustomer.rows[0].id;
    } else {
      const newCustomer = await pool.query(
        `INSERT INTO customers (tenant_id, phone, name) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, normalizedPhone, stripHtml(name.trim())]
      );
      customerId = newCustomer.rows[0].id;
    }

    // Find or create patient record
    const existingPatient = await pool.query(
      `SELECT id FROM patients WHERE tenant_id = $1 AND customer_id = $2 AND LOWER(name) = LOWER($3)`,
      [tenantId, customerId, name.trim()]
    );
    if (existingPatient.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'A patient with this name already exists for this phone number' });
    }

    const newPatient = await pool.query(
      `INSERT INTO patients (tenant_id, customer_id, name, phone, age, gender, blood_group)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [tenantId, customerId, stripHtml(name.trim()), normalizedPhone, age || null, gender || null, blood_group || null]
    );

    // Optional marketing consent recorded by staff (ignored unless it is one of the valid values)
    if (['all', 'checkups', 'none'].includes(req.body.marketing_consent)) {
      await pool.query(
        `UPDATE customers SET marketing_consent = $1, consent_at = NOW(), consent_source = 'staff' WHERE id = $2 AND tenant_id = $3`,
        [req.body.marketing_consent, customerId, tenantId]
      );
    }

    return res.json({ success: true, data: { patient: newPatient.rows[0] } });
  } catch (err) {
    logger.error('Error creating patient:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to create patient' });
  }
}

// PUT /ehr/patients/:patientId/profile -- update patient demographics
async function upsertProfile(req, res, next) {
  if (!isPro(req)) return errorResponse(res, 'EHR is a Pro plan feature', 403);
  try {
    const patientId = req.params.patientId || req.params.customerId;
    if (!isUUID(patientId)) return errorResponse(res, 'Invalid patient ID', 400);
    const { age, gender, blood_group, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship } = req.body;
    const result = await pool.query(`
      UPDATE patients SET
        age = $3,
        gender = $4,
        blood_group = $5,
        emergency_contact_name = $6,
        emergency_contact_phone = $7,
        emergency_contact_relationship = $8,
        updated_at = NOW()
      WHERE id = $2 AND tenant_id = $1
      RETURNING *
    `, [req.tenantId, patientId, age || null, gender || null, blood_group || null, emergency_contact_name ? stripHtml(emergency_contact_name) : null, emergency_contact_phone || null, emergency_contact_relationship ? stripHtml(emergency_contact_relationship) : null]);
    if (!result.rows.length) return errorResponse(res, 'Patient not found', 404);
    return successResponse(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
}

const PATIENT_GENDERS = { male: 'Male', female: 'Female', other: 'Other' };
const PATIENT_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
// Columns of patients this endpoint may change, with the longest allowed text (the phone is handled separately)
const PATIENT_PATCH_TEXT_LIMITS = {
  emergency_contact_name: 255,
  emergency_contact_phone: 20,
  emergency_contact_relationship: 100
};

// A request failure that is answered to the caller (the transaction is rolled back first)
const patchFailure = (status, message, data = null) => Object.assign(new Error(message), { status, data });

// Checks the fields of a PATCH body. Returns { values } (only the fields that were sent) or { error }.
function validatePatientPatch(body) {
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const empty = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  const values = {};

  if (has('name')) {
    const name = typeof body.name === 'string' ? stripHtml(body.name.trim()) : '';
    if (!name) return { error: 'Name is required' };
    if (name.length > 100) return { error: 'Name must be 100 characters or fewer' };
    values.name = name;
  }
  if (has('age')) {
    if (empty(body.age)) {
      values.age = null;
    } else {
      const age = typeof body.age === 'string' ? Number(body.age.trim()) : body.age;
      if (!Number.isInteger(age) || age < 0 || age > 120) return { error: 'Age must be a whole number from 0 to 120' };
      values.age = age;
    }
  }
  if (has('gender')) {
    if (empty(body.gender)) {
      values.gender = null;
    } else {
      const gender = typeof body.gender === 'string' ? PATIENT_GENDERS[body.gender.trim().toLowerCase()] : undefined;
      if (!gender) return { error: 'Gender must be Male, Female or Other' };
      values.gender = gender;
    }
  }
  if (has('blood_group')) {
    if (empty(body.blood_group)) {
      values.blood_group = null;
    } else {
      const group = typeof body.blood_group === 'string' ? body.blood_group.trim().toUpperCase() : '';
      if (!PATIENT_BLOOD_GROUPS.includes(group)) return { error: `Blood group must be one of: ${PATIENT_BLOOD_GROUPS.join(', ')}` };
      values.blood_group = group;
    }
  }
  for (const [column, limit] of Object.entries(PATIENT_PATCH_TEXT_LIMITS)) {
    if (!has(column)) continue;
    if (empty(body[column])) {
      values[column] = null;
    } else {
      if (typeof body[column] !== 'string') return { error: `${column.replace(/_/g, ' ')} must be text` };
      const text = stripHtml(body[column].trim());
      if (text.length > limit) return { error: `${column.replace(/_/g, ' ')} must be ${limit} characters or fewer` };
      values[column] = text || null;
    }
  }
  if (has('phone')) {
    const phone = normalizeCustomerPhone(body.phone);
    if (!phone) return { error: 'Please enter a valid phone number: +91 and 10 digits for India, or + and the country code for other countries.' };
    values.phone = phone;
  }
  return { values };
}

// PATCH /ehr/patients/:patientId -- change demographics of one patient (only the fields that are sent).
// The phone number belongs to the customer (a family can share it), so a phone change has extra rules.
async function updatePatient(req, res, next) {
  if (!isPro(req)) return errorResponse(res, 'EHR is a Pro plan feature', 403);
  const patientId = req.params.patientId;
  if (!isUUID(patientId)) return errorResponse(res, 'Invalid patient ID', 400);
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  const { values, error } = validatePatientPatch(body);
  if (error) return errorResponse(res, error, 400);
  if (Object.keys(values).length === 0) return errorResponse(res, 'No valid fields to update', 400);

  const tenantId = req.tenantId;
  const client = await pool.connect();
  let changedFields = [];
  let phoneChanged = false;
  try {
    await client.query('BEGIN');

    const patientRes = await client.query('SELECT * FROM patients WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [patientId, tenantId]);
    if (!patientRes.rows.length) throw patchFailure(404, 'Patient not found');
    const patient = patientRes.rows[0];

    const customerRes = await client.query('SELECT id, phone FROM customers WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [patient.customer_id, tenantId]);
    if (!customerRes.rows.length) throw patchFailure(404, 'Patient not found');
    const customer = customerRes.rows[0];
    const countRes = await client.query('SELECT COUNT(*)::int AS n FROM patients WHERE customer_id = $1 AND tenant_id = $2', [customer.id, tenantId]);
    const patientCount = countRes.rows[0].n;

    // Phone: the customer's number. An equal number is no change.
    if (values.phone !== undefined && values.phone !== customer.phone) {
      if (patientCount > 1 && body.apply_to_all !== true) {
        throw patchFailure(
          409,
          `${patientCount} patients are registered under this phone number. Changing it applies to all of them. Send apply_to_all: true to confirm.`,
          { patient_count: patientCount }
        );
      }
      const taken = await client.query('SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2 AND id <> $3', [tenantId, values.phone, customer.id]);
      if (taken.rows.length) throw patchFailure(409, 'That number already belongs to another patient record');
      phoneChanged = true;
    }

    // The patients columns that really change (the phone is written to the customer, below)
    const patientChanges = {};
    for (const [column, value] of Object.entries(values)) {
      if (column !== 'phone' && patient[column] !== value) patientChanges[column] = value;
    }
    changedFields = Object.keys(patientChanges);
    if (phoneChanged) changedFields.push('phone');

    if (changedFields.length > 0) {
      const columns = Object.keys(patientChanges);
      if (columns.length > 0) {
        // Column names come from the fixed set validated above, never from the request
        const setClause = columns.map((column, i) => `${column} = $${i + 3}`).join(', ');
        await client.query(
          `UPDATE patients SET ${setClause}, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
          [patientId, tenantId, ...columns.map((column) => patientChanges[column])]
        );
      }

      if (patientChanges.name !== undefined) {
        // Display copy on this patient's bookings; the customer's name follows only when the customer has one patient
        await client.query('UPDATE bookings SET patient_name = $3 WHERE patient_id = $1 AND tenant_id = $2', [patientId, tenantId, patientChanges.name]);
        if (patientCount === 1) {
          await client.query('UPDATE customers SET name = $3 WHERE id = $1 AND tenant_id = $2', [customer.id, tenantId, patientChanges.name]);
        }
      }

      if (phoneChanged) {
        // Consent belongs to the number: the new number starts with no consent and must be asked again
        await client.query(
          `UPDATE customers
           SET phone = $3, marketing_consent = NULL, consent_source = NULL, consent_at = NULL, consent_asked_at = NULL
           WHERE id = $1 AND tenant_id = $2`,
          [customer.id, tenantId, values.phone]
        );
        await client.query(
          'UPDATE patients SET phone = $3, updated_at = NOW() WHERE customer_id = $1 AND tenant_id = $2',
          [customer.id, tenantId, values.phone]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* the connection is released below */ }
    if (err.status) {
      return err.data
        ? res.status(err.status).json({ success: false, data: err.data, error: err.message })
        : errorResponse(res, err.message, err.status);
    }
    if (err.code === '23505' && err.constraint === 'idx_patients_tenant_customer_name') {
      return errorResponse(res, 'A patient with that name already exists under this phone number', 409);
    }
    if (err.code === '23505' && err.constraint === 'customers_tenant_id_phone_key') {
      return errorResponse(res, 'That number already belongs to another patient record', 409);
    }
    return next(err);
  } finally {
    client.release();
  }

  try {
    if (changedFields.length > 0) {
      // Only the names of the changed fields are recorded, never the values
      await logAction({
        tenantId,
        staffId: req.staff?.id,
        action: 'patient_updated',
        entityType: 'patient',
        entityId: patientId,
        metadata: { fields: changedFields, phone_changed: phoneChanged },
        ipAddress: req.ip
      });
    }
    const profile = await loadPatientProfile(patientId, tenantId);
    return successResponse(res, profile);
  } catch (err) {
    return next(err);
  }
}

// POST /ehr/patients/:patientId/conditions -- add condition/allergy/medication
async function addCondition(req, res, next) {
  if (!isPro(req)) return errorResponse(res, 'EHR is a Pro plan feature', 403);
  try {
    const patientId = req.params.patientId || req.params.customerId;
    if (!isUUID(patientId)) return errorResponse(res, 'Invalid patient ID', 400);
    const { type, name, notes } = req.body;
    if (!type || !name) return errorResponse(res, 'Type and name are required', 400);
    if (!['condition', 'allergy', 'medication'].includes(type)) return errorResponse(res, 'Invalid type', 400);
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Condition name is required' });
    if (name.length > 500) return res.status(400).json({ success: false, error: 'Name too long (max 500 chars)' });
    if (notes && notes.length > 1000) return res.status(400).json({ success: false, error: 'Notes too long (max 1000 chars)' });
    const result = await pool.query(`
      INSERT INTO patient_conditions (tenant_id, patient_id, type, name, notes)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [req.tenantId, patientId, type, stripHtml(name), notes ? stripHtml(notes) : null]);
    return successResponse(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// DELETE /ehr/patients/:patientId/conditions/:id -- remove condition
async function deleteCondition(req, res, next) {
  if (!isPro(req)) return errorResponse(res, 'EHR is a Pro plan feature', 403);
  try {
    const patientId = req.params.patientId || req.params.customerId;
    const { id } = req.params;
    if (!isUUID(patientId)) return errorResponse(res, 'Invalid patient ID', 400);
    if (!isUUID(id)) return errorResponse(res, 'Invalid condition ID', 400);
    await pool.query(`DELETE FROM patient_conditions WHERE id = $1 AND patient_id = $2 AND tenant_id = $3`, [id, patientId, req.tenantId]);
    return successResponse(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

// POST /ehr/patients/:patientId/visit-notes -- add visit note
async function addVisitNote(req, res, next) {
  if (!isPro(req)) return errorResponse(res, 'EHR is a Pro plan feature', 403);
  try {
    const patientId = req.params.patientId || req.params.customerId;
    if (!isUUID(patientId)) return errorResponse(res, 'Invalid patient ID', 400);
    const { visit_date, doctor_id, diagnosis, prescription, follow_up_date, notes, booking_id } = req.body;
    if (!visit_date) return errorResponse(res, 'Visit date is required', 400);
    if (diagnosis && diagnosis.length > 5000) return res.status(400).json({ success: false, error: 'Diagnosis too long (max 5000 chars)' });
    if (prescription && prescription.length > 5000) return res.status(400).json({ success: false, error: 'Prescription too long (max 5000 chars)' });
    if (notes && notes.length > 2000) return res.status(400).json({ success: false, error: 'Notes too long (max 2000 chars)' });
    const capitalizeFirst = (str) => str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
    const body = {};
    if (diagnosis) body.diagnosis = capitalizeFirst(stripHtml(diagnosis));
    if (prescription) body.prescription = capitalizeFirst(stripHtml(prescription));
    if (notes) body.notes = capitalizeFirst(stripHtml(notes));
    const result = await pool.query(`
      INSERT INTO visit_notes (tenant_id, patient_id, booking_id, doctor_id, visit_date, diagnosis, prescription, follow_up_date, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *
    `, [req.tenantId, patientId, booking_id || null, doctor_id || null, visit_date, body.diagnosis || null, body.prescription || null, follow_up_date || null, body.notes || null, req.staff.id]);
    return successResponse(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// PUT /ehr/patients/:patientId/visit-notes/:id -- edit visit note
async function updateVisitNote(req, res, next) {
  if (!isPro(req)) return errorResponse(res, 'EHR is a Pro plan feature', 403);
  try {
    const patientId = req.params.patientId || req.params.customerId;
    const { id } = req.params;
    if (!isUUID(patientId)) return errorResponse(res, 'Invalid patient ID', 400);
    if (!isUUID(id)) return errorResponse(res, 'Invalid visit note ID', 400);
    const { visit_date, doctor_id, diagnosis, prescription, follow_up_date, notes } = req.body;
    const capitalizeFirst = (str) => str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
    const body = {};
    if (diagnosis) body.diagnosis = capitalizeFirst(diagnosis);
    if (prescription) body.prescription = capitalizeFirst(prescription);
    if (notes) body.notes = capitalizeFirst(notes);
    const result = await pool.query(`
      UPDATE visit_notes SET
        visit_date = COALESCE($1, visit_date),
        doctor_id = COALESCE($2, doctor_id),
        diagnosis = COALESCE($3, diagnosis),
        prescription = COALESCE($4, prescription),
        follow_up_date = COALESCE($5, follow_up_date),
        notes = COALESCE($6, notes),
        updated_at = NOW()
      WHERE id = $7 AND patient_id = $8 AND tenant_id = $9
      RETURNING *
    `, [visit_date || null, doctor_id || null, body.diagnosis || null, body.prescription || null, follow_up_date || null, body.notes || null, id, patientId, req.tenantId]);
    if (!result.rows.length) return errorResponse(res, 'Visit note not found', 404);
    return successResponse(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
}

module.exports = { getPatients, getConsentSummary, getPatient, createPatient, upsertProfile, updatePatient, addCondition, deleteCondition, addVisitNote, updateVisitNote };

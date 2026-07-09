const pool = require('../../config/database');
const { successResponse, errorResponse } = require('../../utils/response');
const logger = require('../../utils/logger');

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
    const { search } = req.query;
    let query = `
      SELECT p.id, p.name, p.phone, p.age, p.gender, p.blood_group, p.created_at,
             MAX(b.booking_date) as last_visit,
             COUNT(DISTINCT b.id) as total_visits
      FROM patients p
      LEFT JOIN bookings b ON b.patient_id = p.id AND b.tenant_id = p.tenant_id AND b.status = 'completed'
      WHERE p.tenant_id = $1
    `;
    const params = [req.tenantId];
    if (search) {
      query += ` AND (p.name ILIKE $2 OR p.phone ILIKE $2)`;
      params.push(`%${search}%`);
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
    query += ` GROUP BY p.id ORDER BY last_visit DESC NULLS LAST, p.created_at DESC`;
    const result = await pool.query(query, params);
    return successResponse(res, { customers: result.rows, total: result.rows.length });
  } catch (err) {
    next(err);
  }
}

// GET /ehr/patients/:patientId -- full patient profile
async function getPatient(req, res, next) {
  if (!isPro(req)) return errorResponse(res, 'EHR is a Pro plan feature', 403);
  try {
    const rawId = req.params.patientId || req.params.customerId;
    if (!isUUID(rawId)) return errorResponse(res, 'Invalid patient ID', 400);
    // Resolve real patient.id — accepts either patient.id or customer_id
    const patientRes = await pool.query(
      `SELECT * FROM patients WHERE (id = $1 OR customer_id = $1) AND tenant_id = $2 LIMIT 1`,
      [rawId, req.tenantId]
    );
    if (!patientRes.rows.length) return errorResponse(res, 'Patient not found', 404);
    const patientId = patientRes.rows[0].id;
    const customerIdForBookings = patientRes.rows[0].customer_id || rawId;
    const [conditionsRes, visitNotesRes, bookingsRes] = await Promise.all([
      pool.query(`SELECT * FROM patient_conditions WHERE patient_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`, [patientId, req.tenantId]),
      pool.query(`
        SELECT vn.*, d.name as doctor_name, d.specialization as doctor_specialization
        FROM visit_notes vn
        LEFT JOIN clinic_doctors d ON d.id = vn.doctor_id
        WHERE vn.patient_id = $1 AND vn.tenant_id = $2
        ORDER BY vn.visit_date DESC
      `, [patientId, req.tenantId]),
      pool.query(`
        SELECT b.*, d.name as doctor_name, p.name as procedure_name, p.duration_minutes as procedure_duration,
               (SELECT ds.start_time FROM doctor_schedules ds
                WHERE ds.doctor_id = b.doctor_id
                AND ds.day_of_week = EXTRACT(DOW FROM b.booking_date)::integer
                AND ds.tenant_id = b.tenant_id
                AND ds.is_available = true
                ORDER BY ds.start_time ASC LIMIT 1) as session_start_time
        FROM bookings b
        LEFT JOIN clinic_doctors d ON d.id = b.doctor_id
    LEFT JOIN procedures p ON p.id = b.procedure_id
        WHERE (b.patient_id = $1 OR b.customer_id = $2) AND b.tenant_id = $3
        ORDER BY b.booking_date DESC
      `, [patientId, customerIdForBookings, req.tenantId])
    ]);
    const patientRow = patientRes.rows[0];
    return successResponse(res, {
      customer: patientRow,
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
    });
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
        [tenantId, normalizedPhone, name.trim()]
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
      [tenantId, customerId, name.trim(), normalizedPhone, age || null, gender || null, blood_group || null]
    );

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
    `, [req.tenantId, patientId, age || null, gender || null, blood_group || null, emergency_contact_name || null, emergency_contact_phone || null, emergency_contact_relationship || null]);
    if (!result.rows.length) return errorResponse(res, 'Patient not found', 404);
    return successResponse(res, result.rows[0]);
  } catch (err) {
    next(err);
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

module.exports = { getPatients, getPatient, createPatient, upsertProfile, addCondition, deleteCondition, addVisitNote, updateVisitNote };

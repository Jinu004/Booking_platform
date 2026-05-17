const pool = require('../../config/database');
const { successResponse, errorResponse } = require('../../utils/response');
const logger = require('../../utils/logger');

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
      SELECT
        c.id, c.name, c.phone, c.email, c.created_at,
        pp.age, pp.gender, pp.blood_group,
        MAX(b.booking_date) as last_visit,
        COUNT(DISTINCT b.id) as total_visits
      FROM customers c
      LEFT JOIN patient_profiles pp ON pp.customer_id = c.id AND pp.tenant_id = c.tenant_id
      LEFT JOIN bookings b ON b.customer_id = c.id AND b.tenant_id = c.tenant_id AND b.status = 'completed'
      WHERE c.tenant_id = $1
    `;
    const params = [req.tenantId];
    if (search) {
      query += ` AND (c.name ILIKE $2 OR c.phone ILIKE $2)`;
      params.push(`%${search}%`);
    }
    query += ` GROUP BY c.id, c.name, c.phone, c.email, c.created_at, pp.age, pp.gender, pp.blood_group ORDER BY last_visit DESC NULLS LAST, c.created_at DESC`;
    const result = await pool.query(query, params);
    return successResponse(res, { customers: result.rows, total: result.rows.length });
  } catch (err) {
    next(err);
  }
}

// GET /ehr/patients/:customerId -- full patient profile
async function getPatient(req, res, next) {
  if (!isPro(req)) return errorResponse(res, 'EHR is a Pro plan feature', 403);
  try {
    const { customerId } = req.params;
    if (!isUUID(customerId)) return errorResponse(res, 'Invalid customer ID', 400);
    const [customerRes, profileRes, conditionsRes, visitNotesRes, bookingsRes] = await Promise.all([
      pool.query(`SELECT * FROM customers WHERE id = $1 AND tenant_id = $2`, [customerId, req.tenantId]),
      pool.query(`SELECT * FROM patient_profiles WHERE customer_id = $1 AND tenant_id = $2`, [customerId, req.tenantId]),
      pool.query(`SELECT * FROM patient_conditions WHERE customer_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`, [customerId, req.tenantId]),
      pool.query(`
        SELECT vn.*, d.name as doctor_name, d.specialization as doctor_specialization
        FROM visit_notes vn
        LEFT JOIN clinic_doctors d ON d.id = vn.doctor_id
        WHERE vn.customer_id = $1 AND vn.tenant_id = $2
        ORDER BY vn.visit_date DESC
      `, [customerId, req.tenantId]),
      pool.query(`
        SELECT b.*, d.name as doctor_name
        FROM bookings b
        LEFT JOIN clinic_doctors d ON d.id = b.doctor_id
        WHERE b.customer_id = $1 AND b.tenant_id = $2
        ORDER BY b.booking_date DESC
      `, [customerId, req.tenantId])
    ]);
    if (!customerRes.rows.length) return errorResponse(res, 'Patient not found', 404);
    return successResponse(res, {
      customer: customerRes.rows[0],
      profile: profileRes.rows[0] || null,
      conditions: conditionsRes.rows,
      visitNotes: visitNotesRes.rows,
      bookings: bookingsRes.rows
    });
  } catch (err) {
    next(err);
  }
}

// PUT /ehr/patients/:customerId/profile -- create or update patient profile
async function upsertProfile(req, res, next) {
  if (!isPro(req)) return errorResponse(res, 'EHR is a Pro plan feature', 403);
  try {
    const { customerId } = req.params;
    if (!isUUID(customerId)) return errorResponse(res, 'Invalid customer ID', 400);
    const { age, gender, blood_group, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship } = req.body;
    const result = await pool.query(`
      INSERT INTO patient_profiles (tenant_id, customer_id, age, gender, blood_group, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (tenant_id, customer_id) DO UPDATE SET
        age = EXCLUDED.age,
        gender = EXCLUDED.gender,
        blood_group = EXCLUDED.blood_group,
        emergency_contact_name = EXCLUDED.emergency_contact_name,
        emergency_contact_phone = EXCLUDED.emergency_contact_phone,
        emergency_contact_relationship = EXCLUDED.emergency_contact_relationship,
        updated_at = NOW()
      RETURNING *
    `, [req.tenantId, customerId, age || null, gender || null, blood_group || null, emergency_contact_name || null, emergency_contact_phone || null, emergency_contact_relationship || null]);
    return successResponse(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// POST /ehr/patients/:customerId/conditions -- add condition/allergy/medication
async function addCondition(req, res, next) {
  if (!isPro(req)) return errorResponse(res, 'EHR is a Pro plan feature', 403);
  try {
    const { customerId } = req.params;
    if (!isUUID(customerId)) return errorResponse(res, 'Invalid customer ID', 400);
    const { type, name, notes } = req.body;
    if (!type || !name) return errorResponse(res, 'Type and name are required', 400);
    if (!['condition', 'allergy', 'medication'].includes(type)) return errorResponse(res, 'Invalid type', 400);
    const result = await pool.query(`
      INSERT INTO patient_conditions (tenant_id, customer_id, type, name, notes)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [req.tenantId, customerId, type, name, notes || null]);
    return successResponse(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// DELETE /ehr/patients/:customerId/conditions/:id -- remove condition
async function deleteCondition(req, res, next) {
  if (!isPro(req)) return errorResponse(res, 'EHR is a Pro plan feature', 403);
  try {
    const { customerId, id } = req.params;
    if (!isUUID(customerId)) return errorResponse(res, 'Invalid customer ID', 400);
    if (!isUUID(id)) return errorResponse(res, 'Invalid condition ID', 400);
    await pool.query(`DELETE FROM patient_conditions WHERE id = $1 AND customer_id = $2 AND tenant_id = $3`, [id, customerId, req.tenantId]);
    return successResponse(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

// POST /ehr/patients/:customerId/visit-notes -- add visit note
async function addVisitNote(req, res, next) {
  if (!isPro(req)) return errorResponse(res, 'EHR is a Pro plan feature', 403);
  try {
    const { customerId } = req.params;
    if (!isUUID(customerId)) return errorResponse(res, 'Invalid customer ID', 400);
    const { visit_date, doctor_id, diagnosis, prescription, follow_up_date, notes, booking_id } = req.body;
    if (!visit_date) return errorResponse(res, 'Visit date is required', 400);
    const result = await pool.query(`
      INSERT INTO visit_notes (tenant_id, customer_id, booking_id, doctor_id, visit_date, diagnosis, prescription, follow_up_date, notes, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *
    `, [req.tenantId, customerId, booking_id || null, doctor_id || null, visit_date, diagnosis || null, prescription || null, follow_up_date || null, notes || null, req.staff.id]);
    return successResponse(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// PUT /ehr/patients/:customerId/visit-notes/:id -- edit visit note
async function updateVisitNote(req, res, next) {
  if (!isPro(req)) return errorResponse(res, 'EHR is a Pro plan feature', 403);
  try {
    const { customerId, id } = req.params;
    if (!isUUID(customerId)) return errorResponse(res, 'Invalid customer ID', 400);
    if (!isUUID(id)) return errorResponse(res, 'Invalid visit note ID', 400);
    const { visit_date, doctor_id, diagnosis, prescription, follow_up_date, notes } = req.body;
    const result = await pool.query(`
      UPDATE visit_notes SET
        visit_date = COALESCE($1, visit_date),
        doctor_id = COALESCE($2, doctor_id),
        diagnosis = COALESCE($3, diagnosis),
        prescription = COALESCE($4, prescription),
        follow_up_date = COALESCE($5, follow_up_date),
        notes = COALESCE($6, notes),
        updated_at = NOW()
      WHERE id = $7 AND customer_id = $8 AND tenant_id = $9
      RETURNING *
    `, [visit_date || null, doctor_id || null, diagnosis || null, prescription || null, follow_up_date || null, notes || null, id, customerId, req.tenantId]);
    if (!result.rows.length) return errorResponse(res, 'Visit note not found', 404);
    return successResponse(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
}

module.exports = { getPatients, getPatient, upsertProfile, addCondition, deleteCondition, addVisitNote, updateVisitNote };

const ClinicModel = require('./clinic.model');
const pool = require('../../../config/database');
const { successResponse, errorResponse } = require('../../../utils/response');

// Sentinel value used to soft-delete doctors from token queues
// clinic.model.js getDoctors filters out records where leave_days equals this value
const DOCTOR_DELETED_SENTINEL = 999;

// UUID v4 format validation helper
const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

// ISO 8601 date (YYYY-MM-DD) validation helper
const isISODate = (str) => /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));

/**
 * GET /clinic/doctors
 * Lists all doctors
 * Query param: available=true to filter
 */
async function getDoctors(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    let { available } = req.query;
    if (available === 'true') available = true;
    else if (available === 'false') available = false;
    else available = undefined;

    const doctors = await ClinicModel.getDoctors(pool, tenantId, available);
    return successResponse(res, doctors);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /clinic/doctors/:id
 */
async function getDoctorById(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    if (!isUUID(id)) return errorResponse(res, 'Invalid doctor ID', 400);
    const doctor = await ClinicModel.getDoctorById(pool, tenantId, id);
    if (!doctor) {
      return errorResponse(res, 'Doctor not found', 404);
    }
    return successResponse(res, doctor);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /clinic/doctors
 * Creates new doctor — validates required fields, types, and lengths
 */
async function createDoctor(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { name, specialization, phone, qualification, maxTokensDaily, consultationFee } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return errorResponse(res, 'Doctor name is required', 400);
    }
    if (name.length > 255) {
      return errorResponse(res, 'Doctor name must be 255 characters or fewer', 400);
    }
    if (specialization && specialization.length > 255) {
      return errorResponse(res, 'Specialization must be 255 characters or fewer', 400);
    }
    if (maxTokensDaily !== undefined) {
      const parsed = parseInt(maxTokensDaily);
      if (isNaN(parsed) || parsed < 1 || parsed > 500) {
        return errorResponse(res, 'maxTokensDaily must be a number between 1 and 500', 400);
      }
    }
    if (consultationFee !== undefined && isNaN(Number(consultationFee))) {
      return errorResponse(res, 'consultationFee must be a number', 400);
    }

    const doctor = await ClinicModel.createDoctor(pool, tenantId, req.body);
    return successResponse(res, doctor, 201);
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /clinic/doctors/:id/availability
 * Updates doctor availability
 * Body: { available: boolean, leaveDays: number }
 */
async function updateAvailability(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    if (!isUUID(id)) return errorResponse(res, 'Invalid doctor ID', 400);
    const { available, leaveDays } = req.body;

    const doctor = await ClinicModel.updateDoctorAvailability(pool, tenantId, id, available, leaveDays);
    if (!doctor) {
      return errorResponse(res, 'Doctor not found', 404);
    }
    return successResponse(res, doctor);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /clinic/doctors/:id/leave
 * Adds a leave date for doctor
 * Body: { leaveDate: string, reason: string }
 */
async function addLeave(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    if (!isUUID(id)) return errorResponse(res, 'Invalid doctor ID', 400);
    const { leaveDate, reason } = req.body;

    if (!leaveDate) return errorResponse(res, 'leaveDate is required', 400);
    if (!isISODate(leaveDate)) {
      return errorResponse(res, 'leaveDate must be a valid date in YYYY-MM-DD format', 400);
    }

    const leave = await ClinicModel.addDoctorLeave(pool, tenantId, id, leaveDate, reason);
    return successResponse(res, leave, 201);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /clinic/tokens
 * Gets token queue for today
 * Shows all tokens with status
 */
async function getTokenQueue(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const tokens = await ClinicModel.getTokenQueue(pool, tenantId);
    return successResponse(res, tokens);
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /clinic/tokens/:id/status
 * Updates token status
 * Body: { status: waiting|in_progress|done|cancelled }
 */
async function updateTokenStatus(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    if (!isUUID(id)) return errorResponse(res, 'Invalid token ID', 400);
    const { status } = req.body;

    const token = await ClinicModel.updateTokenStatus(pool, tenantId, id, status);
    if (!token) {
      return errorResponse(res, 'Token not found', 404);
    }
    return successResponse(res, token);
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /clinic/doctors/:id
 * Updates doctor details
 */
async function updateDoctor(req, res, next) {
  try {
    const { id } = req.params;
    if (!isUUID(id)) return errorResponse(res, 'Invalid doctor ID', 400);
    const tenantId = req.tenant.id;

    const result = await pool.query(
      `UPDATE clinic_doctors
       SET name = COALESCE($1, name),
           specialization = COALESCE($2, specialization),
           phone = COALESCE($3, phone),
           qualification = COALESCE($4, qualification),
           max_tokens_daily = COALESCE($5, max_tokens_daily),
           consultation_fee = COALESCE($6, consultation_fee)
       WHERE id = $7 AND tenant_id = $8
       RETURNING *`,
      [
        req.body.name,
        req.body.specialization,
        req.body.phone,
        req.body.qualification,
        req.body.maxTokensDaily,
        req.body.consultationFee,
        id,
        tenantId
      ]
    );

    if (!result.rows[0]) {
      return errorResponse(res, 'Doctor not found', 404);
    }

    return successResponse(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /clinic/doctors/:id
 * Soft deletes doctor by marking inactive
 */
async function deleteDoctor(req, res, next) {
  try {
    const { id } = req.params;
    if (!isUUID(id)) return errorResponse(res, 'Invalid doctor ID', 400);
    const tenantId = req.tenant.id;

    const result = await pool.query(
      `UPDATE clinic_doctors
       SET available_today = false,
           leave_days = $3
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [id, tenantId, DOCTOR_DELETED_SENTINEL]
    );

    if (!result.rows[0]) {
      return errorResponse(res, 'Doctor not found', 404);
    }

    return successResponse(
      res, { message: 'Doctor removed successfully' }
    );
  } catch (err) {
    next(err);
  }
}

async function getDoctorSchedule(req, res, next) {
  try {
    const tenantId = req.tenantId || req.tenant?.id;
    const { id } = req.params;
    if (!isUUID(id)) return errorResponse(res, 'Invalid doctor ID', 400);
    const schedule = await ClinicModel.getDoctorSchedule(pool, tenantId, id);
    return res.json({ success: true, data: schedule, error: null });
  } catch (err) {
    next(err);
  }
}

async function saveDoctorSchedule(req, res, next) {
  try {
    const tenantId = req.tenantId || req.tenant?.id;
    const { id } = req.params;
    if (!isUUID(id)) return errorResponse(res, 'Invalid doctor ID', 400);
    const { schedules } = req.body;
    const result = await ClinicModel.saveDoctorSchedule(pool, tenantId, id, schedules);
    const today = new Date().getDay();
    await pool.query('UPDATE clinic_doctors SET available_today = false WHERE id = $1 AND tenant_id = $2 AND leave_days != 999', [id, tenantId]);
    await pool.query(`
      UPDATE clinic_doctors cd SET available_today = true
      FROM doctor_schedules ds
      WHERE ds.doctor_id = cd.id
      AND ds.doctor_id = $1
      AND cd.tenant_id = $2
      AND ds.day_of_week = $3
      AND ds.is_available = true
      AND cd.leave_days != 999
    `, [id, tenantId, today]);
    return res.json({ success: true, data: result, error: null });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getDoctors,
  getDoctorById,
  createDoctor,
  updateAvailability,
  addLeave,
  getTokenQueue,
  updateTokenStatus,
  updateDoctor,
  deleteDoctor,
  getDoctorSchedule,
  saveDoctorSchedule
};

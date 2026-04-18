const ClinicModel = require('./clinic.model');
const pool = require('../../../config/database');
const { successResponse, errorResponse } = require('../../../utils/response');

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
 * Creates new doctor
 */
async function createDoctor(req, res, next) {
  try {
    const tenantId = req.tenant.id;
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
    const { leaveDate, reason } = req.body;

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
    const tenantId = req.tenant.id;

    const result = await pool.query(
      `UPDATE clinic_doctors
       SET available_today = false,
           leave_days = 999
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [id, tenantId]
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

module.exports = {
  getDoctors,
  getDoctorById,
  createDoctor,
  updateAvailability,
  addLeave,
  getTokenQueue,
  updateTokenStatus,
  updateDoctor,
  deleteDoctor
};

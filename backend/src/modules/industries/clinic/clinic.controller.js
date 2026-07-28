const ClinicModel = require('./clinic.model');
const pool = require('../../../config/database');
const { successResponse, errorResponse } = require('../../../utils/response');
const { sendTemplateMessage, sendMessage } = require('../../channel/whatsapp/whatsapp.adapter');

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
    if (error.code === 'DOCTOR_BUSY') {
      return errorResponse(res, error.message, 409);
    }
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
       SET name                     = COALESCE($1, name),
           specialization           = COALESCE($2, specialization),
           phone                    = COALESCE($3, phone),
           qualification            = COALESCE($4, qualification),
           max_tokens_daily         = COALESCE($5, max_tokens_daily),
           consultation_fee         = COALESCE($6, consultation_fee),
           profile_description      = COALESCE($9, profile_description),
           avg_consultation_minutes = COALESCE($10, avg_consultation_minutes)
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
        tenantId,
        req.body.profileDescription !== undefined ? req.body.profileDescription : null,
        req.body.avgConsultationMinutes !== undefined ? parseInt(req.body.avgConsultationMinutes) : null
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
           is_active = false,
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
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getDay();
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

async function getProcedures(req, res, next) {
  try {
    const tenantId = req.tenantId || req.tenant?.id;
    const { id } = req.params;
    if (!isUUID(id)) return errorResponse(res, 'Invalid doctor ID', 400);
    const procedures = await ClinicModel.getProcedures(pool, tenantId, id);
    return successResponse(res, procedures);
  } catch (err) { next(err); }
}

async function createProcedure(req, res, next) {
  try {
    const tenantId = req.tenantId || req.tenant?.id;
    const { id } = req.params;
    if (!isUUID(id)) return errorResponse(res, 'Invalid doctor ID', 400);
    const { name, duration_minutes } = req.body;
    if (!name || !duration_minutes) return errorResponse(res, 'name and duration_minutes are required', 400);
    const procedure = await ClinicModel.createProcedure(pool, tenantId, id, name, duration_minutes);
    return successResponse(res, procedure, 201);
  } catch (err) { next(err); }
}

async function deleteProcedure(req, res, next) {
  try {
    const tenantId = req.tenantId || req.tenant?.id;
    const { procedureId } = req.params;
    if (!isUUID(procedureId)) return errorResponse(res, 'Invalid procedure ID', 400);
    const deleted = await ClinicModel.deleteProcedure(pool, tenantId, procedureId);
    if (!deleted) return errorResponse(res, 'Procedure not found', 404);
    return successResponse(res, deleted);
  } catch (err) { next(err); }
}

async function getAvailableSlots(req, res, next) {
  try {
    const tenantId = req.tenantId || req.tenant?.id;
    const { id } = req.params;
    if (!isUUID(id)) return errorResponse(res, 'Invalid doctor ID', 400);
    const { date, duration } = req.query;
    if (!date || !isISODate(date)) return errorResponse(res, 'Valid date (YYYY-MM-DD) is required', 400);
    if (!duration || isNaN(parseInt(duration))) return errorResponse(res, 'duration (minutes) is required', 400);
    const slots = await ClinicModel.getAvailableSlots(pool, tenantId, id, date, parseInt(duration));
    return successResponse(res, slots);
  } catch (err) { next(err); }
}

async function createProcedureBooking(req, res, next) {
  try {
    const tenantId = req.tenantId || req.tenant?.id;
    const { id } = req.params;
    if (!isUUID(id)) return errorResponse(res, 'Invalid doctor ID', 400);
    const { procedure_id, customer_id, patient_id, patient_name, date, start_time, end_time } = req.body;
    if (!procedure_id || !patient_name || !date || !start_time || !end_time) {
      return errorResponse(res, 'procedure_id, patient_name, date, start_time and end_time are required', 400);
    }
    if (!isISODate(date)) return errorResponse(res, 'Valid date (YYYY-MM-DD) is required', 400);
    const booking = await ClinicModel.createProcedureBooking(pool, tenantId, id, procedure_id, customer_id, patient_id, patient_name, date, start_time, end_time);

    // Send WhatsApp notification to patient
    setImmediate(async () => {
      try {
        const phoneRes = await pool.query(`SELECT phone FROM customers WHERE id = $1`, [customer_id]);
        const procRes = await pool.query(`SELECT name FROM procedures WHERE id = $1`, [procedure_id]);
        if (phoneRes.rows.length && procRes.rows.length) {
          const phone = phoneRes.rows[0].phone;
          const procedureName = procRes.rows[0].name;
          const formattedDate = new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
          const formattedTime = (() => { const [h, m] = start_time.split(':'); const hr = parseInt(h); return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`; })();
          const confirmationMsg = `Hi ${patient_name}! 🏥 Your ${procedureName} has been scheduled for ${formattedDate} at ${formattedTime}. Please arrive a few minutes early and contact us if you need to reschedule.`;
          try {
            await sendMessage(phone, confirmationMsg);
          } catch (msgErr) {
            const metaCode = msgErr.response?.data?.error?.code;
            if (metaCode === 131026) {
              await sendTemplateMessage(phone, 'procedure_scheduled', 'en', [
                { type: 'body', parameters: [
                  { type: 'text', text: procedureName },
                  { type: 'text', text: formattedDate },
                  { type: 'text', text: formattedTime }
                ]}
              ]);
            } else {
              throw msgErr;
            }
          }
        }
      } catch (err) {
        console.error('Procedure WhatsApp notification failed:', err.message);
      }
    });

    return successResponse(res, booking, 201);
  } catch (err) { next(err); }
}

async function cancelProcedureBooking(req, res, next) {
  try {
    const tenantId = req.tenantId || req.tenant?.id;
    const { bookingId } = req.params;
    if (!isUUID(bookingId)) return errorResponse(res, 'Invalid booking ID', 400);
    const booking = await ClinicModel.cancelProcedureBooking(pool, tenantId, bookingId);
    return successResponse(res, booking);
  } catch (err) { next(err); }
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
  saveDoctorSchedule,
  getProcedures,
  createProcedure,
  deleteProcedure,
  getAvailableSlots,
  createProcedureBooking,
  cancelProcedureBooking
};

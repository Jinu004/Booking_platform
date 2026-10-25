const ClinicModel = require('./clinic.model');
const pool = require('../../../config/database');
const { successResponse, errorResponse } = require('../../../utils/response');
const { sendTemplateMessage } = require('../../channel/whatsapp/whatsapp.adapter');
const { runAsTenant } = require('../../channel/whatsapp/senderContext');
const { validatePhoneInput } = require('../../../utils/phone');
const logger = require('../../../utils/logger');

// Sentinel value used to soft-delete doctors from token queues
// clinic.model.js getDoctors filters out records where leave_days equals this value
const DOCTOR_DELETED_SENTINEL = 999;

// UUID v4 format validation helper
const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

// ISO 8601 date (YYYY-MM-DD) validation helper
const isISODate = (str) => /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));

// The date ("13 Jul 2026") and time ("9:00 AM") texts of the procedure_scheduled template
function templateDateText(date) {
  // The date arrives as YYYY-MM-DD (read as UTC midnight), so it is also written in UTC: the same text on a server in any time zone
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function templateTimeText(startTime) {
  const [h, m] = startTime.split(':');
  const hr = parseInt(h);
  return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}

// True only when the doctor exists in this clinic (an id from another clinic is treated as unknown)
async function doctorInTenant(tenantId, doctorId) {
  return !!(await ClinicModel.getDoctorById(pool, tenantId, doctorId));
}

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

    if (!(await doctorInTenant(tenantId, id))) return errorResponse(res, 'Not found', 404);

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
 * GET /clinic/queue
 * Today's live queue for tokens and appointments (one row per booking, see ClinicModel.getQueue).
 * A doctor receives only their own rows; other roles see every doctor, optionally filtered by ?doctor_id.
 */
async function getQueue(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    let doctorId = null;
    if (req.staff?.role === 'doctor') {
      if (!req.staff.doctor_id) return errorResponse(res, 'Your account is not linked to a doctor. Ask your admin.', 403);
      doctorId = req.staff.doctor_id;
    } else if (req.query.doctor_id) {
      if (!isUUID(String(req.query.doctor_id))) return errorResponse(res, 'Invalid doctor ID', 400);
      doctorId = String(req.query.doctor_id);
    }
    const rows = await ClinicModel.getQueue(pool, tenantId, { doctorId });
    return successResponse(res, rows);
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /clinic/tokens/:id/status
 * Updates token status
 * Body: { status: waiting|arrived|in_progress|completed }
 */
async function updateTokenStatus(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    if (!isUUID(id)) return errorResponse(res, 'Invalid token ID', 400);
    // A doctor changes tokens of their own schedule only (an unknown token still answers 404 below, as before)
    if (req.staff?.role === 'doctor') {
      if (!req.staff.doctor_id) return errorResponse(res, 'You can only change your own schedule.', 403);
      const owner = await pool.query('SELECT doctor_id FROM clinic_tokens WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
      if (owner.rows.length && owner.rows[0].doctor_id !== req.staff.doctor_id) {
        return errorResponse(res, 'You can only change your own schedule.', 403);
      }
    }
    const { status } = req.body;
    // The values the dashboard sends today (arrived, in_progress, completed) plus waiting and arrived for stepping back
    if (!['waiting', 'arrived', 'in_progress', 'completed'].includes(status)) {
      return errorResponse(res, 'Invalid status', 400);
    }

    const token = await ClinicModel.updateTokenStatus(pool, tenantId, id, status);
    if (!token) {
      return errorResponse(res, 'Token not found', 404);
    }
    return successResponse(res, token);
  } catch (error) {
    if (error.code === 'DOCTOR_BUSY') {
      return errorResponse(res, error.message, 409);
    }
    if (error.code === 'TOKEN_CLOSED') {
      return errorResponse(res, error.message, 400);
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
    if (!(await doctorInTenant(tenantId, id))) return errorResponse(res, 'Not found', 404);
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
    if (!(await doctorInTenant(tenantId, id))) return errorResponse(res, 'Not found', 404);
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
    let durationMinutes = parseInt(duration);
    if (!duration || isNaN(durationMinutes)) {
      // Only an appointment-mode clinic may leave the duration out: the doctor's visit length is used. Token mode is unchanged.
      if ((await ClinicModel.getBookingMode(pool, tenantId)) !== 'appointment') return errorResponse(res, 'duration (minutes) is required', 400);
      const doctor = await ClinicModel.getDoctorById(pool, tenantId, id);
      if (!doctor) return errorResponse(res, 'Not found', 404);
      durationMinutes = ClinicModel.getVisitLengthMinutes(doctor.avg_consultation_minutes);
    }
    const slots = await ClinicModel.getAvailableSlots(pool, tenantId, id, date, durationMinutes);
    return successResponse(res, slots);
  } catch (err) { next(err); }
}

/**
 * POST /clinic/doctors/:id/appointment-booking
 * Staff books a time-based appointment (appointment mode only). Body: patient_name, phone, date, start_time (HH:MM), notes?, marketing_consent?
 * The visit length is the doctor's average consultation time (15 minutes when not set). 409 when the time overlaps another time-based booking.
 */
async function createAppointmentBooking(req, res, next) {
  try {
    const tenantId = req.tenantId || req.tenant?.id;
    const { id } = req.params;
    if (!isUUID(id)) return errorResponse(res, 'Invalid doctor ID', 400);
    // A doctor books for their own schedule only (the same rule as the manual token booking)
    if (req.staff?.role === 'doctor' && !req.staff?.doctor_id) {
      return errorResponse(res, 'Your account is not linked to a doctor. Ask your admin.', 403);
    }
    if (req.staff?.role === 'doctor' && req.staff.doctor_id !== id) {
      return errorResponse(res, 'You can only book for your own schedule.', 403);
    }
    const { patient_name, phone, date, start_time, notes, marketing_consent, send_whatsapp } = req.body;

    const patientName = Array.from(String(patient_name || '').trim().replace(/<[^>]*>/g, '')).slice(0, 255).join('');
    if (!patientName) return errorResponse(res, 'patient_name is required', 400);
    const phoneCheck = validatePhoneInput(phone);
    if (!phoneCheck.ok) return errorResponse(res, phoneCheck.error, 400);
    const normalizedPhone = phoneCheck.phone;
    if (!date || !isISODate(date)) return errorResponse(res, 'Valid date (YYYY-MM-DD) is required', 400);
    const timeMatch = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(start_time || '').trim());
    if (!timeMatch) return errorResponse(res, 'Invalid start_time. Use HH:MM', 400);
    const startTime = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;

    const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const todayStr = `${todayIST.getFullYear()}-${String(todayIST.getMonth() + 1).padStart(2, '0')}-${String(todayIST.getDate()).padStart(2, '0')}`;
    if (date < todayStr) return errorResponse(res, 'Cannot book an appointment in the past', 400);
    if (date === todayStr && (parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10)) <= todayIST.getHours() * 60 + todayIST.getMinutes()) {
      return errorResponse(res, 'Cannot book an appointment at a time that has already passed', 400);
    }

    // The doctor must belong to this clinic (an id from another clinic answers the same 404 as an unknown id)
    if (!(await doctorInTenant(tenantId, id))) return errorResponse(res, 'Not found', 404);
    if ((await ClinicModel.getBookingMode(pool, tenantId)) !== 'appointment') {
      return errorResponse(res, 'Appointment booking is not turned on for this clinic', 409);
    }

    const booking = await ClinicModel.createAppointmentBooking(pool, tenantId, id, {
      patientName,
      phone: normalizedPhone,
      notes: String(notes || '').trim().replace(/<[^>]*>/g, '').slice(0, 2000),
      date,
      startTime,
      marketingConsent: marketing_consent
    });

    // Optional confirmation (off unless send_whatsapp is exactly true). Sent after the booking is saved; a failure never affects it.
    if (send_whatsapp === true) {
      setImmediate(async () => {
        await runAsTenant(tenantId, async () => {
          try {
            const phoneRes = await pool.query('SELECT phone FROM customers WHERE id = $1 AND tenant_id = $2', [booking.customer_id, tenantId]);
            const savedPhone = phoneRes.rows[0]?.phone;
            if (!savedPhone) return;
            await sendTemplateMessage(savedPhone, 'procedure_scheduled', 'en', [
              { type: 'body', parameters: [
                { type: 'text', text: 'consultation' },
                { type: 'text', text: templateDateText(booking.confirmation.date) },
                { type: 'text', text: templateTimeText(booking.confirmation.start_time) }
              ]}
            ]);
          } catch (err) {
            logger.warn(`Appointment WhatsApp confirmation failed: ${String(err && err.message).slice(0, 120)}`);
          }
        });
      });
    }
    return successResponse(res, booking, 201);
  } catch (err) { next(err); }
}

async function createProcedureBooking(req, res, next) {
  try {
    const tenantId = req.tenantId || req.tenant?.id;
    const { id } = req.params;
    if (!isUUID(id)) return errorResponse(res, 'Invalid doctor ID', 400);
    // A doctor books for their own schedule only (the same rule as the manual token booking)
    if (req.staff?.role === 'doctor' && !req.staff?.doctor_id) {
      return errorResponse(res, 'Your account is not linked to a doctor. Ask your admin.', 403);
    }
    if (req.staff?.role === 'doctor' && req.staff.doctor_id !== id) {
      return errorResponse(res, 'You can only book for your own schedule.', 403);
    }
    const { procedure_id, customer_id, patient_id, date, start_time, end_time, phone, name, send_whatsapp } = req.body;
    // "name" is accepted as an alternative to patient_name. Cleaned like the appointment handler: text only, HTML tags removed,
    // at most 255 characters. A missing or non-text name stays '' so the required-field check below still answers 400.
    const rawPatientName = req.body.patient_name || name;
    const patient_name = typeof rawPatientName === 'string'
      ? Array.from(rawPatientName.trim().replace(/<[^>]*>/g, '')).slice(0, 255).join('').trim()
      : '';
    if (!procedure_id || !patient_name || !date || !start_time || !end_time) {
      return errorResponse(res, 'procedure_id, patient_name, date, start_time and end_time are required', 400);
    }
    if (!isISODate(date)) return errorResponse(res, 'Valid date (YYYY-MM-DD) is required', 400);

    const toMinutes = (t) => { const [h, m] = t.toString().split(':').map(Number); return h * 60 + m; };
    const startMins = toMinutes(start_time);
    const endMins = toMinutes(end_time);

    if (isNaN(startMins) || isNaN(endMins)) return errorResponse(res, 'Invalid time format. Use HH:MM', 400);
    if (endMins <= startMins) return errorResponse(res, 'End time must be after start time', 400);

    const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const todayStr = `${todayIST.getFullYear()}-${String(todayIST.getMonth()+1).padStart(2,'0')}-${String(todayIST.getDate()).padStart(2,'0')}`;
    if (date < todayStr) return errorResponse(res, 'Cannot book a procedure in the past', 400);
    if (date === todayStr) {
      const nowMins = todayIST.getHours() * 60 + todayIST.getMinutes();
      if (startMins <= nowMins) return errorResponse(res, 'Cannot book a procedure at a time that has already passed', 400);
    }

    // The doctor, procedure, customer and patient must all belong to this clinic. Any miss answers the same 404,
    // so nothing reveals whether an id exists in another clinic.
    const notFound = () => errorResponse(res, 'Not found', 404);
    if (!isUUID(procedure_id) || (customer_id && !isUUID(customer_id)) || (patient_id && !isUUID(patient_id))) return notFound();
    if (!(await doctorInTenant(tenantId, id))) return notFound();
    const procOwn = await pool.query('SELECT 1 FROM procedures WHERE id = $1 AND tenant_id = $2 AND doctor_id = $3', [procedure_id, tenantId, id]);
    if (!procOwn.rows.length) return notFound();
    if (customer_id) {
      const custOwn = await pool.query('SELECT 1 FROM customers WHERE id = $1 AND tenant_id = $2', [customer_id, tenantId]);
      if (!custOwn.rows.length) return notFound();
    }
    if (patient_id) {
      // A patient belongs to one customer: when both ids are sent they must match
      const patOwn = await pool.query(
        'SELECT 1 FROM patients WHERE id = $1 AND tenant_id = $2 AND ($3::uuid IS NULL OR customer_id = $3::uuid)',
        [patient_id, tenantId, customer_id || null]
      );
      if (!patOwn.rows.length) return notFound();
    }

    // Without a customer_id a phone number can be given: the customer and patient are then found or created with the booking
    let contact;
    if (!customer_id && phone) {
      const phoneCheck = validatePhoneInput(phone);
      if (!phoneCheck.ok) return errorResponse(res, phoneCheck.error, 400);
      contact = { phone: phoneCheck.phone };
    }

    const booking = await ClinicModel.createProcedureBooking(pool, tenantId, id, procedure_id, customer_id, patient_id, patient_name, date, start_time, end_time, contact);

    // Send WhatsApp notification to patient (unless send_whatsapp is exactly false)
    if (send_whatsapp !== false) setImmediate(async () => {
      await runAsTenant(tenantId, async () => {
      try {
        const phoneRes = await pool.query(`SELECT phone FROM customers WHERE id = $1 AND tenant_id = $2`, [booking.customer_id, tenantId]);
        const procRes = await pool.query(`SELECT name FROM procedures WHERE id = $1 AND tenant_id = $2`, [procedure_id, tenantId]);
        if (phoneRes.rows.length && procRes.rows.length) {
          const phone = phoneRes.rows[0].phone;
          const procedureName = procRes.rows[0].name;
          const formattedDate = templateDateText(date);
          const formattedTime = templateTimeText(start_time);
          // Only the approved template is sent: this confirmation is usually outside the 24-hour window.
          // A failed send is logged and recorded by the send helper (META_SEND_FAILED and send_failures).
          await sendTemplateMessage(phone, 'procedure_scheduled', 'en', [
            { type: 'body', parameters: [
              { type: 'text', text: procedureName },
              { type: 'text', text: formattedDate },
              { type: 'text', text: formattedTime }
            ]}
          ]);
        }
      } catch (err) {
        console.error('Procedure WhatsApp notification failed:', err.message);
      }
      });
    });

    return successResponse(res, booking, 201);
  } catch (err) { next(err); }
}

async function cancelProcedureBooking(req, res, next) {
  try {
    const tenantId = req.tenantId || req.tenant?.id;
    const { bookingId } = req.params;
    if (!isUUID(bookingId)) return errorResponse(res, 'Invalid booking ID', 400);
    // A doctor cancels procedures of their own schedule only (an unknown booking is handled by the model as before)
    if (req.staff?.role === 'doctor') {
      if (!req.staff.doctor_id) return errorResponse(res, 'You can only change your own schedule.', 403);
      const owner = await pool.query(
        `SELECT doctor_id FROM bookings WHERE id = $1 AND tenant_id = $2 AND booking_type = 'procedure'`,
        [bookingId, tenantId]
      );
      if (owner.rows.length && owner.rows[0].doctor_id !== req.staff.doctor_id) {
        return errorResponse(res, 'You can only change your own schedule.', 403);
      }
    }
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
  getQueue,
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
  createAppointmentBooking,
  cancelProcedureBooking
};

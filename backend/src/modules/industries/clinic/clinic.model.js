const tenantQuery = require('../../../utils/tenantQuery');

// An error that carries the HTTP status the global error handler should answer with (409 for a double booking, 404 for an unknown id)
class BookingError extends Error {
  constructor(message, statusCode = 409) {
    super(message);
    this.name = 'BookingError';
    this.statusCode = statusCode;
  }
}

const minutesOf = (t) => { const [h, m] = t.toString().split(':').map(Number); return h * 60 + m; };
const timeOf = (mins) => `${Math.floor(mins / 60).toString().padStart(2, '0')}:${(mins % 60).toString().padStart(2, '0')}`;

// The length of one time-based visit (appointment, or a booking without an end time): the doctor's average
// consultation time when it is set and greater than zero, otherwise 15 minutes. The one place this default lives.
const DEFAULT_VISIT_MINUTES = 15;
function getVisitLengthMinutes(avgConsultationMinutes) {
  const minutes = parseInt(avgConsultationMinutes, 10);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_VISIT_MINUTES;
}

// The clinic's booking mode, from the tenant_configs key booking_mode. Anything but 'appointment' (or no value) is 'token'.
async function getBookingMode(pool, tenantId) {
  const res = await pool.query(`SELECT value FROM tenant_configs WHERE tenant_id = $1 AND key = 'booking_mode'`, [tenantId]);
  return res.rows[0]?.value === 'appointment' ? 'appointment' : 'token';
}

/**
 * Gets all doctors for a tenant
 * @param {object} pool
 * @param {string} tenantId
 * @param {boolean} availableOnly
 * @returns {Promise<Array>}
 */
async function getDoctors(pool, tenantId, availableOnly) {
  let sql = `SELECT *, EXISTS (
      SELECT 1 FROM doctor_schedules ds
      WHERE ds.doctor_id = clinic_doctors.id
        AND ds.day_of_week = EXTRACT(DOW FROM CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
        AND ds.is_available = true
        AND ds.start_time <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::time
        AND ds.end_time >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::time
    ) AS available_now
    FROM clinic_doctors WHERE tenant_id = $1 AND leave_days != 999 AND is_active = true`;
  const params = [];
  let paramCount = 2;

  if (availableOnly !== undefined) {
    sql += ` AND available_today = $${paramCount}`;
    params.push(availableOnly);
    paramCount++;
    sql += ` AND EXISTS (
      SELECT 1 FROM doctor_schedules ds
      WHERE ds.doctor_id = clinic_doctors.id
        AND ds.day_of_week = EXTRACT(DOW FROM CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
        AND ds.is_available = true
        AND ds.start_time <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::time
        AND ds.end_time >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::time
    )`;
  }

  sql += ` ORDER BY name ASC`;
  const result = await tenantQuery(tenantId, pool, sql, params);
  return result.rows;
}

/**
 * Gets doctor by ID
 */
async function getDoctorById(pool, tenantId, doctorId) {
  const sql = `SELECT * FROM clinic_doctors WHERE tenant_id = $1 AND id = $2`;
  const result = await tenantQuery(tenantId, pool, sql, [doctorId]);
  return result.rows.length ? result.rows[0] : null;
}

/**
 * Creates a new doctor
 */
async function createDoctor(pool, tenantId, doctorData) {
  const { name, specialization, phone, email, qualification, maxTokensDaily, consultationFee, avgConsultationMinutes } = doctorData;
  const sql = `
    INSERT INTO clinic_doctors (tenant_id, name, specialization, phone, email, qualification, max_tokens_daily, consultation_fee, avg_consultation_minutes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `;
  const result = await tenantQuery(tenantId, pool, sql, [
    name,
    specialization || null,
    phone || null,
    email || null,
    qualification || null,
    maxTokensDaily || 30,
    consultationFee || 0,
    avgConsultationMinutes || 10
  ]);
  return result.rows[0];
}

/**
 * Updates doctor availability
 * Used by staff to mark doctor present/absent
 */
async function updateDoctorAvailability(pool, tenantId, doctorId, available, leaveDays) {
  const sql = `
    UPDATE clinic_doctors 
    SET available_today = $2, leave_days = $3 
    WHERE tenant_id = $1 AND id = $4
    RETURNING *
  `;
  const result = await tenantQuery(tenantId, pool, sql, [available, leaveDays || 0, doctorId]);
  return result.rows.length ? result.rows[0] : null;
}

/**
 * Gets doctor schedule
 * Returns day_of_week and time slots
 */
async function getDoctorSchedule(pool, tenantId, doctorId) {
  const sql = `SELECT * FROM doctor_schedules WHERE tenant_id = $1 AND doctor_id = $2 ORDER BY day_of_week ASC`;
  const result = await tenantQuery(tenantId, pool, sql, [doctorId]);
  return result.rows;
}

async function saveDoctorSchedule(pool, tenantId, doctorId, schedules) {
  // Delete existing schedules for this doctor
  await tenantQuery(tenantId, pool,
    `DELETE FROM doctor_schedules WHERE tenant_id = $1 AND doctor_id = $2`,
    [doctorId]
  );
  // Insert new schedules
  for (const schedule of schedules) {
    if (schedule.is_available) {
      await tenantQuery(tenantId, pool,
        `INSERT INTO doctor_schedules (tenant_id, doctor_id, day_of_week, start_time, end_time, is_available)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [doctorId, schedule.day_of_week, schedule.start_time, schedule.end_time, true]
      );
    }
  }
  return getDoctorSchedule(pool, tenantId, doctorId);
}

/**
 * Adds doctor leave date
 */
async function addDoctorLeave(pool, tenantId, doctorId, leaveDate, reason) {
  const sql = `
    INSERT INTO doctor_leaves (tenant_id, doctor_id, leave_date, reason) 
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  const result = await tenantQuery(tenantId, pool, sql, [doctorId, leaveDate, reason || null]);
  return result.rows[0];
}

/**
 * Gets token queue for today
 */
async function getTokenQueue(pool, tenantId) {
  const sql = `
SELECT ct.*, b.notes, b.slot_time, b.source,
       COALESCE(b.patient_name, c.name) AS patient_name,
       c.phone AS patient_phone,
       cd.name AS doctor_name,
       ct.doctor_id AS doctor_id,
       b.patient_id AS patient_id,
       b.customer_id AS customer_id
    FROM clinic_tokens ct
    JOIN bookings b ON b.id = ct.booking_id
    LEFT JOIN customers c ON c.id = b.customer_id
    JOIN clinic_doctors cd ON cd.id = ct.doctor_id
    WHERE ct.tenant_id = $1
    AND ct.status != 'cancelled'
    AND b.booking_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
    ORDER BY b.slot_time ASC NULLS LAST, ct.token_number ASC
  `
  const result = await tenantQuery(tenantId, pool, sql, [])
  return result.rows
}
/**
 * Today's live queue for any booking mode (GET /clinic/queue): token bookings (they have a clinic_tokens row) and appointment bookings
 * (booking_type 'appointment'), one row per booking. Procedure bookings and cancelled/no-show bookings are left out.
 * queue_status is computed here and only here: waiting | arrived | in_consult | done.
 * @param {object} options - { doctorId } limits the rows to one doctor
 */
async function getQueue(pool, tenantId, { doctorId = null } = {}) {
  const params = [tenantId];
  let doctorClause = '';
  if (doctorId) {
    params.push(doctorId);
    doctorClause = ` AND COALESCE(ct.doctor_id, b.doctor_id) = $${params.length}`;
  }
  const sql = `
    SELECT q.* FROM (
      SELECT b.id,
             ct.id AS token_id,
             COALESCE(b.booking_type, 'normal') AS booking_type,
             ct.token_number AS token_number,
             b.slot_time,
             b.end_time,
             CASE
               WHEN ct.id IS NOT NULL THEN
                 CASE ct.status WHEN 'arrived' THEN 'arrived' WHEN 'in_progress' THEN 'in_consult' WHEN 'completed' THEN 'done' WHEN 'done' THEN 'done' ELSE 'waiting' END
               WHEN b.status = 'completed' THEN 'done'
               WHEN b.consult_started_at IS NOT NULL THEN 'in_consult'
               WHEN b.arrived_at IS NOT NULL THEN 'arrived'
               ELSE 'waiting'
             END AS queue_status,
             COALESCE(b.patient_name, c.name) AS patient_name,
             c.phone AS patient_phone,
             COALESCE(ct.doctor_id, b.doctor_id) AS doctor_id,
             cd.name AS doctor_name,
             b.notes,
             b.source,
             b.patient_id,
             b.customer_id,
             b.arrived_at,
             b.consult_started_at,
             b.created_at
      FROM bookings b
      LEFT JOIN clinic_tokens ct ON ct.booking_id = b.id
      LEFT JOIN customers c ON c.id = b.customer_id
      JOIN clinic_doctors cd ON cd.id = COALESCE(ct.doctor_id, b.doctor_id)
      WHERE b.tenant_id = $1
        AND b.booking_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
        AND b.status NOT IN ('cancelled', 'noshow')
        AND (ct.id IS NOT NULL OR b.booking_type = 'appointment')
        AND ct.status IS DISTINCT FROM 'cancelled'${doctorClause}
    ) q
    ORDER BY q.doctor_name ASC NULLS LAST, q.doctor_id,
      CASE q.queue_status WHEN 'in_consult' THEN 0 WHEN 'arrived' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END,
      CASE WHEN q.slot_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN q.slot_time::time END ASC NULLS LAST,
      q.token_number ASC NULLS LAST, q.created_at ASC, q.id ASC
  `;
  const result = await tenantQuery(tenantId, pool, sql, params.slice(1));
  return result.rows;
}

/**
 * Updates token status
 */
async function updateTokenStatus(pool, tenantId, tokenId, status) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A finished or cancelled token cannot be stepped back: its booking is already completed or no-show and would be left inconsistent
    const current = await client.query('SELECT status FROM clinic_tokens WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, tokenId]);
    if (!current.rows.length) { await client.query('ROLLBACK'); return null; }
    if (['completed', 'done', 'cancelled'].includes(current.rows[0].status) && ['waiting', 'arrived', 'in_progress'].includes(status)) {
      throw Object.assign(new Error('This patient is already finished.'), { code: 'TOKEN_CLOSED' });
    }
    const tokenRes = await client.query(
      `UPDATE clinic_tokens SET status = $1 WHERE tenant_id = $2 AND id = $3 RETURNING *`,
      [status, tenantId, tokenId]
    );
    if (!tokenRes.rows.length) { await client.query('ROLLBACK'); return null; }
    const token = tokenRes.rows[0];
    if (status === 'completed' && token.booking_id) {
      await client.query(
        `UPDATE bookings SET status = 'completed' WHERE id = $1 AND tenant_id = $2`,
        [token.booking_id, tenantId]
      );
    }
    if (status === 'in_progress' && token.booking_id) {
      await client.query(
        `UPDATE bookings SET status = 'confirmed' WHERE id = $1 AND tenant_id = $2`,
        [token.booking_id, tenantId]
      );
    }
    await client.query('COMMIT');
    return token;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getProcedures(pool, tenantId, doctorId) {
  const result = await pool.query(`SELECT * FROM procedures WHERE tenant_id = $1 AND doctor_id = $2 ORDER BY name ASC`, [tenantId, doctorId]);
  return result.rows;
}

async function createProcedure(pool, tenantId, doctorId, name, durationMinutes) {
  const result = await pool.query(`INSERT INTO procedures (tenant_id, doctor_id, name, duration_minutes) VALUES ($1, $2, $3, $4) RETURNING *`, [tenantId, doctorId, name, durationMinutes]);
  return result.rows[0];
}

async function deleteProcedure(pool, tenantId, procedureId) {
  const result = await pool.query(`DELETE FROM procedures WHERE id = $1 AND tenant_id = $2 RETURNING *`, [procedureId, tenantId]);
  return result.rows[0];
}

async function getAvailableSlots(pool, tenantId, doctorId, date, durationMinutes) {
  const toMinutes = (t) => { const [h, m] = t.toString().split(':').map(Number); return h * 60 + m; };
  const toTimeStr = (mins) => { const h = Math.floor(mins / 60).toString().padStart(2, '0'); const m = (mins % 60).toString().padStart(2, '0'); return `${h}:${m}`; };

  const overrideRes = await pool.query(`SELECT sessions FROM schedule_overrides WHERE tenant_id = $1 AND doctor_id = $2 AND override_date = $3`, [tenantId, doctorId, date]);
  let sessions = [];
  if (overrideRes.rows.length > 0) {
    sessions = overrideRes.rows[0].sessions;
  } else {
    const dow = new Date(date).getDay();
    const schedRes = await pool.query(`SELECT start_time, end_time FROM doctor_schedules WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3 AND is_available = true ORDER BY start_time ASC`, [tenantId, doctorId, dow]);
    sessions = schedRes.rows.map(r => ({ start_time: r.start_time, end_time: r.end_time }));
  }
  if (sessions.length === 0) return [];

  // Appointment mode: only time-based bookings (procedures and appointments) take time. Token mode is unchanged.
  const appointmentMode = (await getBookingMode(pool, tenantId)) === 'appointment';
  const bookingsRes = await pool.query(`SELECT b.slot_time, b.end_time, b.booking_type, cd.avg_consultation_minutes FROM bookings b JOIN clinic_doctors cd ON cd.id = b.doctor_id WHERE b.tenant_id = $1 AND b.doctor_id = $2 AND b.booking_date = $3 AND b.status NOT IN ('cancelled', 'noshow')${appointmentMode ? " AND b.booking_type IN ('procedure', 'appointment')" : ''} ORDER BY b.slot_time ASC`, [tenantId, doctorId, date]);
  const bookedSlots = bookingsRes.rows;

  const availableSlots = [];
  for (const session of sessions) {
    let cursor = toMinutes(session.start_time);
    const sessionEnd = toMinutes(session.end_time);
    const avgMins = appointmentMode
      ? getVisitLengthMinutes(bookedSlots[0]?.avg_consultation_minutes)
      : (bookedSlots.length > 0 ? (parseInt(bookedSlots[0].avg_consultation_minutes) || 20) : 20);
    const bookedInSession = bookedSlots
      .filter(b => b.slot_time && toMinutes(b.slot_time) >= cursor && toMinutes(b.slot_time) < sessionEnd)
      .map(b => ({ start: toMinutes(b.slot_time), end: b.end_time ? toMinutes(b.end_time) : toMinutes(b.slot_time) + avgMins }))
      .sort((a, b) => a.start - b.start);

    // Generate all possible start times at 30-min intervals within free windows
    const freeWindows = [];
    let windowStart = cursor;
    for (const booked of bookedInSession) {
      if (booked.start > windowStart) freeWindows.push({ start: windowStart, end: booked.start });
      windowStart = Math.max(windowStart, booked.end);
    }
    if (sessionEnd > windowStart) freeWindows.push({ start: windowStart, end: sessionEnd });

    for (const window of freeWindows) {
      const snap = Math.ceil(window.start / 15) * 15;
      let t = snap;
      while (t + durationMinutes <= window.end) {
        availableSlots.push(toTimeStr(t));
        t += 15;
      }
    }
  }
  // Filter out past slots if booking is for today
  const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const todayStr = `${nowIST.getFullYear()}-${String(nowIST.getMonth()+1).padStart(2,'0')}-${String(nowIST.getDate()).padStart(2,'0')}`;
  if (date === todayStr) {
    const nowMins = nowIST.getHours() * 60 + nowIST.getMinutes();
    return availableSlots.filter(s => toMinutes(s) > nowMins);
  }
  return availableSlots;
}

// Locks the doctor row (the same first step as the normal booking flow: createManualBooking and the AI booking tools), so
// bookings for the same doctor are handled one after the other, and returns the doctor row. 404 when the doctor is not in this clinic.
async function lockDoctor(client, tenantId, doctorId) {
  const doctorLock = await client.query(
    'SELECT id, name, avg_consultation_minutes FROM clinic_doctors WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [doctorId, tenantId]
  );
  if (!doctorLock.rows.length) {
    throw new BookingError('Not found', 404);
  }
  return doctorLock.rows[0];
}

// Throws 409 when [startTime, endTime) overlaps a booking of this doctor. Cancelled and no-show bookings are ignored, as in
// getAvailableSlots, so a slot the screen offers as free is never refused here. Time-based bookings (procedure, appointment)
// conflict when their time windows overlap. With includeTokenBookings, a normal booking whose slot_time falls inside the window
// conflicts too (the procedure rule); an appointment only competes with other time-based bookings.
async function assertNoOverlap(client, tenantId, doctorId, date, startTime, endTime, includeTokenBookings) {
  const conflictRes = await client.query(
    `SELECT id FROM bookings
     WHERE tenant_id = $1 AND doctor_id = $2 AND booking_date = $3
     AND status NOT IN ('cancelled', 'noshow')
     AND slot_time IS NOT NULL
     AND (
       ${includeTokenBookings ? "((booking_type IS NULL OR booking_type NOT IN ('procedure', 'appointment')) AND slot_time::time >= $4::time AND slot_time::time < $5::time) OR" : ''}
       (booking_type IN ('procedure', 'appointment') AND end_time IS NOT NULL AND slot_time::time < $5::time AND end_time::time > $4::time)
     )
     LIMIT 1`,
    [tenantId, doctorId, date, startTime, endTime]
  );
  if (conflictRes.rows.length > 0) {
    throw new BookingError('That time is already booked for this doctor', 409);
  }
}

// Finds or creates the customer of a phone number and the patient of that name (the same steps as the appointment booking), inside
// the caller's transaction. The phone is already validated and normalised. Returns { customerId, patientId }.
async function findOrCreateCustomerAndPatient(client, tenantId, phone, patientName) {
  const cusRes = await client.query('SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2 LIMIT 1', [tenantId, phone]);
  let customerId;
  if (cusRes.rows.length > 0) {
    customerId = cusRes.rows[0].id;
  } else {
    const insertCus = await client.query('INSERT INTO customers (tenant_id, phone, name) VALUES ($1, $2, $3) RETURNING id', [tenantId, phone, patientName]);
    customerId = insertCus.rows[0].id;
  }
  let patientId;
  const existingPatient = await client.query(
    `SELECT id FROM patients WHERE tenant_id = $1 AND customer_id = $2 AND LOWER(name) = LOWER($3)`,
    [tenantId, customerId, patientName]
  );
  if (existingPatient.rows.length > 0) {
    patientId = existingPatient.rows[0].id;
  } else {
    const newPatient = await client.query(
      `INSERT INTO patients (tenant_id, customer_id, name, phone)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, customer_id, LOWER(name)) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [tenantId, customerId, patientName, phone]
    );
    patientId = newPatient.rows[0]?.id || null;
  }
  return { customerId, patientId };
}

// Optional last argument contact = { phone } (normalised): used only when customerId is missing. The customer and patient are then
// found or created in the same transaction as the booking and linked to it.
async function createProcedureBooking(pool, tenantId, doctorId, procedureId, customerId, patientId, patientName, date, startTime, endTime, contact) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockDoctor(client, tenantId, doctorId);
    await assertNoOverlap(client, tenantId, doctorId, date, startTime, endTime, true);
    if (!customerId && contact && contact.phone) {
      const resolved = await findOrCreateCustomerAndPatient(client, tenantId, contact.phone, patientName);
      customerId = resolved.customerId;
      patientId = resolved.patientId;
    }
    const bookingRes = await client.query(
      `INSERT INTO bookings (tenant_id, doctor_id, customer_id, patient_id, patient_name, booking_date, slot_time, end_time, booking_type, procedure_id, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'procedure', $9, 'confirmed') RETURNING *`,
      [tenantId, doctorId, customerId, patientId || null, patientName, date, startTime, endTime, procedureId]
    );
    const booking = bookingRes.rows[0];

    const overrideRes = await client.query(`SELECT sessions FROM schedule_overrides WHERE tenant_id = $1 AND doctor_id = $2 AND override_date = $3`, [tenantId, doctorId, date]);
    let sessions = [];
    if (overrideRes.rows.length > 0) {
      sessions = overrideRes.rows[0].sessions;
    } else {
      const dow = new Date(date).getDay();
      const schedRes = await client.query(`SELECT start_time, end_time FROM doctor_schedules WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3 AND is_available = true ORDER BY start_time ASC`, [tenantId, doctorId, dow]);
      sessions = schedRes.rows.map(r => ({ start_time: r.start_time, end_time: r.end_time }));
    }

    const toMinutes = (t) => { const [h, m] = t.toString().split(':').map(Number); return h * 60 + m; };
    const toTimeStr = (mins) => { const h = Math.floor(mins / 60).toString().padStart(2, '0'); const m = (mins % 60).toString().padStart(2, '0'); return `${h}:${m}`; };
    const procStart = toMinutes(startTime);
    const procEnd = toMinutes(endTime);

    const newSessions = [];
    for (const s of sessions) {
      const sStart = toMinutes(s.start_time);
      const sEnd = toMinutes(s.end_time);
      if (sEnd <= procStart || sStart >= procEnd) {
        newSessions.push(s);
      } else {
        if (sStart < procStart) newSessions.push({ start_time: toTimeStr(sStart), end_time: toTimeStr(procStart) });
        if (sEnd > procEnd) newSessions.push({ start_time: toTimeStr(procEnd), end_time: toTimeStr(sEnd) });
      }
    }

    await client.query(
      `INSERT INTO schedule_overrides (tenant_id, doctor_id, override_date, sessions) VALUES ($1, $2, $3, $4) ON CONFLICT (doctor_id, override_date) DO UPDATE SET sessions = $4`,
      [tenantId, doctorId, date, JSON.stringify(newSessions)]
    );

    await client.query('COMMIT');
    return booking;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Creates a time-based appointment for a doctor (appointment mode): no token, no schedule_overrides cut.
 * The visit lasts getVisitLengthMinutes(doctor) from startTime. The customer and patient are found or created
 * as in the manual booking path. All writes are one transaction under the doctor row lock.
 * Optional inputs: source ('dashboard' or 'whatsapp', anything else is 'dashboard') and patientId (an existing patient of the
 * customer with this phone: used instead of looking up or creating a patient by name; 404 if it is not a patient of this clinic,
 * 400 if it belongs to another phone number).
 * Returns the booking row plus patient_phone, doctor_name and a confirmation object (booking_id, doctor_name, date, start_time, end_time).
 * @param {{ patientName: string, phone: string, notes?: string, date: string, startTime: string (HH:MM), marketingConsent?: string, source?: string, patientId?: string }} input
 */
async function createAppointmentBooking(pool, tenantId, doctorId, input) {
  const { patientName, phone, notes, date, startTime, marketingConsent, patientId: patientIdInput } = input;
  const bookingSource = input.source === 'whatsapp' ? 'whatsapp' : 'dashboard';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const doctor = await lockDoctor(client, tenantId, doctorId);

    const startMins = minutesOf(startTime);
    const endMins = startMins + getVisitLengthMinutes(doctor.avg_consultation_minutes);
    if (endMins > 24 * 60) throw new BookingError('That appointment would run past midnight', 400);
    const endTime = timeOf(endMins);

    // The visit must fit inside one session of that day (when the doctor has sessions on it, as in the manual booking path)
    const overrideRes = await client.query(`SELECT sessions FROM schedule_overrides WHERE tenant_id = $1 AND doctor_id = $2 AND override_date = $3`, [tenantId, doctorId, date]);
    let sessions;
    if (overrideRes.rows.length > 0) {
      sessions = overrideRes.rows[0].sessions;
    } else {
      const dow = new Date(date).getDay();
      const schedRes = await client.query(`SELECT start_time, end_time FROM doctor_schedules WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3 AND is_available = true`, [tenantId, doctorId, dow]);
      sessions = schedRes.rows;
    }
    if (sessions.length > 0 && !sessions.some(s => startMins >= minutesOf(s.start_time) && endMins <= minutesOf(s.end_time))) {
      throw new BookingError('That time is outside the doctor\'s session hours', 409);
    }

    await assertNoOverlap(client, tenantId, doctorId, date, startTime, endTime, false);

    // Find or create the customer and the patient, as the manual booking path does
    const cusRes = await client.query('SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2 LIMIT 1', [tenantId, phone]);
    let customerId;
    if (cusRes.rows.length > 0) {
      customerId = cusRes.rows[0].id;
    } else {
      // A given patient must already belong to this phone number's customer: there is none yet
      if (patientIdInput) throw new BookingError('That patient does not belong to this phone number', 400);
      const insertCus = await client.query('INSERT INTO customers (tenant_id, phone, name) VALUES ($1, $2, $3) RETURNING id', [tenantId, phone, patientName]);
      customerId = insertCus.rows[0].id;
    }
    if (['all', 'checkups', 'none'].includes(marketingConsent)) {
      await client.query(
        `UPDATE customers SET marketing_consent = $1, consent_at = NOW(), consent_source = 'staff' WHERE id = $2 AND tenant_id = $3`,
        [marketingConsent, customerId, tenantId]
      );
    }
    let patientId;
    let bookedName = patientName;
    if (patientIdInput) {
      // Use this exact patient (looked up by id and clinic), and the name stored for it
      const givenPatient = await client.query('SELECT id, name, customer_id FROM patients WHERE id = $1 AND tenant_id = $2', [patientIdInput, tenantId]);
      if (!givenPatient.rows.length) throw new BookingError('Patient not found', 404);
      if (givenPatient.rows[0].customer_id !== customerId) throw new BookingError('That patient does not belong to this phone number', 400);
      patientId = givenPatient.rows[0].id;
      bookedName = givenPatient.rows[0].name;
    } else {
      const existingPatient = await client.query(
        `SELECT id FROM patients WHERE tenant_id = $1 AND customer_id = $2 AND LOWER(name) = LOWER($3)`,
        [tenantId, customerId, patientName]
      );
      if (existingPatient.rows.length > 0) {
        patientId = existingPatient.rows[0].id;
      } else {
        const newPatient = await client.query(
          `INSERT INTO patients (tenant_id, customer_id, name, phone)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, customer_id, LOWER(name)) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [tenantId, customerId, patientName, phone]
        );
        patientId = newPatient.rows[0]?.id || null;
      }
    }

    const bookingRes = await client.query(
      `INSERT INTO bookings (tenant_id, customer_id, doctor_id, source, status, booking_date, notes, patient_name, patient_id, slot_time, end_time, booking_type)
       VALUES ($1, $2, $3, $10, 'confirmed', $4, $5, $6, $7, $8, $9, 'appointment')
       RETURNING *`,
      [tenantId, customerId, doctorId, date, notes || '', bookedName, patientId, startTime, endTime, bookingSource]
    );

    await client.query('COMMIT');
    const booking = bookingRes.rows[0];
    booking.patient_phone = phone;
    booking.doctor_name = doctor.name;
    // What a confirmation message needs (date as plain YYYY-MM-DD text)
    booking.confirmation = { booking_id: booking.id, doctor_name: doctor.name, date, start_time: startTime, end_time: endTime };
    return booking;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function rebuildScheduleOverridesAfterCancel(pool, tenantId, doctorId, bookingDate, excludeBookingId) {
  const toMinutes = (t) => { const [h, m] = t.toString().split(':').map(Number); return h * 60 + m; };
  const toTimeStr = (mins) => { const h = Math.floor(mins / 60).toString().padStart(2, '0'); const m = (mins % 60).toString().padStart(2, '0'); return `${h}:${m}`; };
  const remainingRes = await pool.query(
    `SELECT slot_time, end_time FROM bookings
     WHERE tenant_id = $1 AND doctor_id = $2 AND booking_date = $3
     AND booking_type = 'procedure' AND status != 'cancelled'
     ${excludeBookingId ? 'AND id != $4' : ''}
     ORDER BY slot_time ASC`,
    excludeBookingId ? [tenantId, doctorId, bookingDate, excludeBookingId] : [tenantId, doctorId, bookingDate]
  );
  const remaining = remainingRes.rows;
  if (remaining.length === 0) {
    await pool.query(
      `DELETE FROM schedule_overrides WHERE tenant_id = $1 AND doctor_id = $2 AND override_date = $3`,
      [tenantId, doctorId, bookingDate]
    );
  } else {
    const dow = new Date(bookingDate).getDay();
    const schedRes = await pool.query(
      `SELECT start_time, end_time FROM doctor_schedules
       WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3 AND is_available = true
       ORDER BY start_time ASC`,
      [tenantId, doctorId, dow]
    );
    let sessions = schedRes.rows.map(r => ({ start_time: r.start_time, end_time: r.end_time }));
    for (const proc of remaining) {
      const procStart = toMinutes(proc.slot_time);
      const procEnd = toMinutes(proc.end_time);
      const newSessions = [];
      for (const s of sessions) {
        const sStart = toMinutes(s.start_time);
        const sEnd = toMinutes(s.end_time);
        if (sEnd <= procStart || sStart >= procEnd) {
          newSessions.push(s);
        } else {
          if (sStart < procStart) newSessions.push({ start_time: toTimeStr(sStart), end_time: toTimeStr(procStart) });
          if (sEnd > procEnd) newSessions.push({ start_time: toTimeStr(procEnd), end_time: toTimeStr(sEnd) });
        }
      }
      sessions = newSessions;
    }
    await pool.query(
      `INSERT INTO schedule_overrides (tenant_id, doctor_id, override_date, sessions) VALUES ($1, $2, $3, $4)
       ON CONFLICT (doctor_id, override_date) DO UPDATE SET sessions = $4`,
      [tenantId, doctorId, bookingDate, JSON.stringify(sessions)]
    );
  }
}

async function cancelProcedureBooking(pool, tenantId, bookingId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bookingRes = await client.query(
      `UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND tenant_id = $2 AND booking_type = 'procedure' RETURNING *`,
      [bookingId, tenantId]
    );
    if (!bookingRes.rows.length) throw new Error('Procedure booking not found');
    const booking = bookingRes.rows[0];
    const { doctor_id, booking_date } = booking;
    await rebuildScheduleOverridesAfterCancel(pool, tenantId, doctor_id, booking_date, bookingId);
    await client.query('COMMIT');
    return booking;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  getDoctors,
  getDoctorById,
  createDoctor,
  updateDoctorAvailability,
  getDoctorSchedule,
  saveDoctorSchedule,
  addDoctorLeave,
  getTokenQueue,
  getQueue,
  updateTokenStatus,
  getProcedures,
  createProcedure,
  deleteProcedure,
  getAvailableSlots,
  createProcedureBooking,
  createAppointmentBooking,
  getBookingMode,
  getVisitLengthMinutes,
  cancelProcedureBooking,
  rebuildScheduleOverridesAfterCancel
};

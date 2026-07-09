const tenantQuery = require('../../../utils/tenantQuery');

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
  const { name, specialization, phone, email, qualification, maxTokensDaily, consultationFee } = doctorData;
  const sql = `
    INSERT INTO clinic_doctors (tenant_id, name, specialization, phone, email, qualification, max_tokens_daily, consultation_fee)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;
  const result = await tenantQuery(tenantId, pool, sql, [
    name,
    specialization || null,
    phone || null,
    email || null,
    qualification || null,
    maxTokensDaily || 30,
    consultationFee || 0
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
SELECT ct.*, b.notes,
       COALESCE(b.patient_name, c.name) AS patient_name,
       cd.name AS doctor_name,
       ct.doctor_id AS doctor_id
    FROM clinic_tokens ct
    JOIN bookings b ON b.id = ct.booking_id
    LEFT JOIN customers c ON c.id = b.customer_id
    JOIN clinic_doctors cd ON cd.id = ct.doctor_id
    WHERE ct.tenant_id = $1
    AND ct.status != 'cancelled'
    AND b.booking_date = CURRENT_DATE
    ORDER BY ct.token_number ASC
  `
  const result = await tenantQuery(tenantId, pool, sql, [])
  return result.rows
}
/**
 * Updates token status
 */
async function updateTokenStatus(pool, tenantId, tokenId, status) {
  const sql = `
    UPDATE clinic_tokens 
    SET status = $2 
    WHERE tenant_id = $1 AND id = $3
    RETURNING *
  `;
  const result = await tenantQuery(tenantId, pool, sql, [status, tokenId]);
  return result.rows.length ? result.rows[0] : null;
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

  const bookingsRes = await pool.query(`SELECT slot_time, end_time, booking_type FROM bookings WHERE tenant_id = $1 AND doctor_id = $2 AND booking_date = $3 AND status NOT IN ('cancelled', 'noshow') ORDER BY slot_time ASC`, [tenantId, doctorId, date]);
  const bookedSlots = bookingsRes.rows;

  const availableSlots = [];
  for (const session of sessions) {
    let cursor = toMinutes(session.start_time);
    const sessionEnd = toMinutes(session.end_time);
    const bookedInSession = bookedSlots
      .filter(b => b.slot_time && toMinutes(b.slot_time) >= cursor && toMinutes(b.slot_time) < sessionEnd)
      .map(b => ({ start: toMinutes(b.slot_time), end: b.end_time ? toMinutes(b.end_time) : toMinutes(b.slot_time) + 10 }))
      .sort((a, b) => a.start - b.start);
    for (const booked of bookedInSession) {
      if (booked.start - cursor >= durationMinutes) availableSlots.push(toTimeStr(cursor));
      cursor = Math.max(cursor, booked.end);
    }
    if (sessionEnd - cursor >= durationMinutes) availableSlots.push(toTimeStr(cursor));
  }
  return availableSlots;
}

async function createProcedureBooking(pool, tenantId, doctorId, procedureId, customerId, patientName, date, startTime, endTime) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bookingRes = await client.query(
      `INSERT INTO bookings (tenant_id, doctor_id, customer_id, patient_name, booking_date, slot_time, end_time, booking_type, procedure_id, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'procedure', $8, 'confirmed') RETURNING *`,
      [tenantId, doctorId, customerId, patientName, date, startTime, endTime, procedureId]
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

async function cancelProcedureBooking(pool, tenantId, bookingId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bookingRes = await client.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND tenant_id = $2 AND booking_type = 'procedure' RETURNING *`, [bookingId, tenantId]);
    if (!bookingRes.rows.length) throw new Error('Procedure booking not found');
    const booking = bookingRes.rows[0];
    await client.query(`DELETE FROM schedule_overrides WHERE tenant_id = $1 AND doctor_id = $2 AND override_date = $3`, [tenantId, booking.doctor_id, booking.booking_date]);
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
  updateTokenStatus,
  getProcedures,
  createProcedure,
  deleteProcedure,
  getAvailableSlots,
  createProcedureBooking,
  cancelProcedureBooking
};

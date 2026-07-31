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
       ct.doctor_id AS doctor_id
    FROM clinic_tokens ct
    JOIN bookings b ON b.id = ct.booking_id
    LEFT JOIN customers c ON c.id = b.customer_id
    JOIN clinic_doctors cd ON cd.id = ct.doctor_id
    WHERE ct.tenant_id = $1
    AND ct.status != 'cancelled'
    AND b.booking_date = CURRENT_DATE
    ORDER BY b.slot_time ASC NULLS LAST, ct.token_number ASC
  `
  const result = await tenantQuery(tenantId, pool, sql, [])
  return result.rows
}
/**
 * Updates token status
 */
async function updateTokenStatus(pool, tenantId, tokenId, status) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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

async function createProcedureBooking(pool, tenantId, doctorId, procedureId, customerId, patientId, patientName, date, startTime, endTime) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Check for normal token bookings overlapping the procedure slot
    const conflictRes = await client.query(
      `SELECT id FROM bookings
       WHERE tenant_id = $1 AND doctor_id = $2 AND booking_date = $3
       AND status != 'cancelled'
       AND (booking_type IS NULL OR booking_type != 'procedure')
       AND slot_time IS NOT NULL
       AND slot_time >= $4 AND slot_time < $5`,
      [tenantId, doctorId, date, startTime, endTime]
    );
    if (conflictRes.rows.length > 0) {
      throw new Error('A patient appointment already exists in this time slot. Please choose a different time.');
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
  updateTokenStatus,
  getProcedures,
  createProcedure,
  deleteProcedure,
  getAvailableSlots,
  createProcedureBooking,
  cancelProcedureBooking,
  rebuildScheduleOverridesAfterCancel
};

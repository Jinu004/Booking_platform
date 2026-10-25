const pool = require('../../config/database');
const BookingModel = require('./booking.model');
const ConflictEngine = require('./booking.conflict');
const logger = require('../../utils/logger');
const { v4: uuidv4 } = require('uuid');
const tenantQuery = require('../../utils/tenantQuery');
const { rebuildScheduleOverridesAfterCancel } = require('../industries/clinic/clinic.model');

/**
 * Creates a booking with conflict prevention
 * Full flow:
 * 1. Check doctor availability
 * 2. Acquire slot lock
 * 3. Get next token number
 * 4. Create booking record
 * 5. Create token record
 * 6. Release lock on error
 *
 * @param {string} tenantId
 * @param {object} bookingData - {
 *   customerId, doctorId, source,
 *   bookingDate, notes, conversationId
 * }
 * @returns {Promise<object>} Created booking with token
 */
async function createBookingWithToken(tenantId, bookingData) {
  const { doctorId, bookingDate, slotTime } = bookingData;
  const requestId = uuidv4();
  let lockAcquired = false;

  try {
    // 1. Check doctor availability
    const doctorRes = await pool.query(
      `SELECT max_tokens_daily, available_today, avg_consultation_minutes FROM clinic_doctors WHERE id = $1 AND tenant_id = $2`,
      [doctorId, tenantId]
    );

    if (doctorRes.rows.length === 0) {
      throw new Error('Doctor not found');
    }

    const doctor = doctorRes.rows[0];
    if (!doctor.available_today) {
      throw new Error('Doctor is not available today');
    }

    // Calculate dynamic max tokens from session time / avg_consultation_minutes
    const avgMins = doctor.avg_consultation_minutes || 10;
    const targetDate = bookingDate || (() => { const _d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })); return `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`; })();
    const overrideRes = await pool.query(
      `SELECT sessions FROM schedule_overrides WHERE tenant_id = $1 AND doctor_id = $2 AND override_date = $3`,
      [tenantId, doctorId, targetDate]
    );
    let sessions = [];
    if (overrideRes.rows.length > 0) {
      sessions = overrideRes.rows[0].sessions;
    } else {
      const dow = new Date(targetDate + 'T00:00:00').getDay();
      const schedRes = await pool.query(
        `SELECT start_time, end_time FROM doctor_schedules WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3 AND is_available = true`,
        [tenantId, doctorId, dow]
      );
      sessions = schedRes.rows;
    }
    const toMinutes = (t) => { const [h, m] = t.toString().split(':').map(Number); return h * 60 + m; };
    const toTimeStr = (mins) => { const h = Math.floor(mins / 60).toString().padStart(2, '0'); const m = (mins % 60).toString().padStart(2, '0'); return `${h}:${m}`; };

    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const todayIST = `${nowIST.getFullYear()}-${String(nowIST.getMonth()+1).padStart(2,'0')}-${String(nowIST.getDate()).padStart(2,'0')}`;
    const isToday = targetDate === todayIST;
    const currentMins = isToday ? nowIST.getHours() * 60 + nowIST.getMinutes() : 0;

    let totalMinutes = 0;
    let sessionStart = null;
    let sessionEnd = null;

    if (slotTime && isToday) {
      const slotMins = toMinutes(slotTime);
      const targetSession = sessions.find(s => slotMins >= toMinutes(s.start_time) && slotMins < toMinutes(s.end_time));
      if (targetSession) {
        const effectiveStart = Math.max(toMinutes(targetSession.start_time), currentMins);
        const effectiveEnd = toMinutes(targetSession.end_time);
        totalMinutes = Math.max(0, effectiveEnd - effectiveStart);
        sessionStart = toTimeStr(toMinutes(targetSession.start_time));
        sessionEnd = toTimeStr(toMinutes(targetSession.end_time));
      } else {
        totalMinutes = sessions.reduce((sum, s) => sum + (toMinutes(s.end_time) - toMinutes(s.start_time)), 0);
      }
    } else if (isToday) {
      totalMinutes = sessions.reduce((sum, s) => {
        const effectiveStart = Math.max(toMinutes(s.start_time), currentMins);
        const effectiveEnd = toMinutes(s.end_time);
        return sum + Math.max(0, effectiveEnd - effectiveStart);
      }, 0);
    } else {
      totalMinutes = sessions.reduce((sum, s) => sum + (toMinutes(s.end_time) - toMinutes(s.start_time)), 0);
    }

    const dynamicMax = totalMinutes > 0 ? Math.floor(totalMinutes / avgMins) : (isToday && slotTime ? 0 : (doctor.max_tokens_daily || 30));
    const maxTokens = doctor.max_tokens_daily ? Math.min(dynamicMax, doctor.max_tokens_daily) : dynamicMax;

    const capacity = await ConflictEngine.checkDoctorCapacity(pool, tenantId, doctorId, maxTokens, sessionStart, sessionEnd);

    if (!capacity.available) {
      throw new Error('Doctor is fully booked for today');
    }

    // 2. Acquire slot lock
    lockAcquired = await ConflictEngine.acquireSlotLock(tenantId, doctorId, bookingDate, requestId);
    if (!lockAcquired) {
      // Slot is currently being booked by another request — fail closed to prevent duplicates
      const lockError = new Error('Booking slot is busy, please try again in a moment');
      lockError.statusCode = 429;
      throw lockError;
    }

    // 3. Get next token number
    const tokenNumber = await ConflictEngine.getNextTokenNumber(tenantId, doctorId, bookingDate, sessions, slotTime);

    // 4. Create booking record
    const booking = await BookingModel.createBooking(pool, tenantId, {
      ...bookingData,
      tokenNumber
    });

    // 5. Create token record
    const tokenSql = `
      INSERT INTO clinic_tokens 
      (tenant_id, booking_id, doctor_id, token_number, status) 
      VALUES ($1, $2, $3, $4, 'waiting') 
      RETURNING *
    `;
    const tokenRes = await tenantQuery(tenantId, pool, tokenSql, [booking.id, doctorId, tokenNumber]);

    return {
      booking,
      token: tokenRes.rows[0]
    };
  } catch (error) {
    logger.error(`Error in createBookingWithToken: ${error.message}`);
    throw error;
  } finally {
    // 6. Release lock
    if (lockAcquired) {
      await ConflictEngine.releaseSlotLock(tenantId, doctorId, bookingDate, requestId);
    }
  }
}

/**
 * Gets bookings for dashboard with pagination
 *
 * @param {string} tenantId
 * @param {object} options - {
 *   date, status, doctorId, customerId, page, limit
 * }
 * @returns {Promise<object>} { bookings, total, page }
 */
async function getBookingsDashboard(tenantId, options) {
  const { date, status, doctorId, customerId, page, limit, upcoming } = options;
  const bookings = await BookingModel.getBookings(pool, tenantId, {
    date, status, doctorId, customerId, page: parseInt(page), limit: parseInt(limit), upcoming
  });

  // Calculate total for pagination (simplistic here, a real count query is better)
  let countSql = `SELECT COUNT(*) FROM bookings WHERE tenant_id = $1`;
  const params = [tenantId];
  let paramCount = 2;
  if (date) { countSql += ` AND booking_date = $${paramCount++}`; params.push(date); }
  if (status) { countSql += ` AND status = $${paramCount++}`; params.push(status); }
  if (doctorId) { countSql += ` AND doctor_id = $${paramCount++}`; params.push(doctorId); }
  if (customerId) { countSql += ` AND customer_id = $${paramCount++}`; params.push(customerId); }

  const countRes = await pool.query(countSql, params);
  const total = parseInt(countRes.rows[0].count);

  return { bookings, total, page: parseInt(page), limit: parseInt(limit) };
}

/**
 * Cancels booking with business rules
 * Cannot cancel if consultation already started
 * Sends cancellation notification (stub for Sprint 5)
 *
 * @param {string} tenantId
 * @param {string} bookingId
 * @param {string} cancelledBy - 'patient' or 'staff'
 * @returns {Promise<object>} Cancelled booking
 */
async function cancelBookingWithRules(tenantId, bookingId, cancelledBy) {
  const tokenSql = `SELECT status FROM clinic_tokens WHERE tenant_id = $1 AND booking_id = $2`;
  const tokenRes = await pool.query(tokenSql, [tenantId, bookingId]);
  
  if (tokenRes.rows.length > 0) {
    const tokenStatus = tokenRes.rows[0].status;
    if (tokenStatus === 'in_progress' || tokenStatus === 'done') {
      throw new Error(`Cannot cancel booking. Consultation is ${tokenStatus}.`);
    }
  }

  const cancelledBooking = await BookingModel.cancelBooking(pool, tenantId, bookingId);
  if (cancelledBooking && cancelledBooking.booking_type === 'procedure') {
    await rebuildScheduleOverridesAfterCancel(pool, tenantId, cancelledBooking.doctor_id, cancelledBooking.booking_date, null);
  }
  // TODO: Sprint 5 notification logic here
  logger.info(`Booking ${bookingId} cancelled by ${cancelledBy}`);

  return cancelledBooking;
}

/**
 * Marks booking as completed
 * Updates token status to done
 * Records consultation end time
 *
 * @param {string} tenantId
 * @param {string} bookingId
 * @returns {Promise<object>}
 */
async function completeBooking(tenantId, bookingId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const bookingSql = `
      UPDATE bookings 
      SET status = 'completed', updated_at = NOW() 
      WHERE tenant_id = $1 AND id = $2 
      RETURNING *
    `;
    const bookingRes = await tenantQuery(tenantId, client, bookingSql, [bookingId]);
    
    const tokenSql = `
      UPDATE clinic_tokens 
      SET status = 'done', consultation_end = NOW() 
      WHERE tenant_id = $1 AND booking_id = $2
    `;
    await tenantQuery(tenantId, client, tokenSql, [bookingId]);

    await client.query('COMMIT');
    return bookingRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Live queue actions for an APPOINTMENT booking (tokens use PATCH /clinic/tokens/:id/status):
 *   'waiting'    clears arrived_at and consult_started_at (undo)
 *   'arrived'    sets arrived_at (once); from in consult it clears consult_started_at and keeps arrived_at (undo)
 *   'in_consult' sets consult_started_at (once) and arrived_at when it is still empty
 * A move to the state the booking is already in changes nothing and returns the current state.
 * Only for today's (IST) appointments of this clinic that are still confirmed or pending. A doctor may act on their own bookings only.
 * One patient in consult per doctor: refused (409) while that doctor has an appointment in consult today, or a token in progress today.
 * The booking row and then the doctor row are locked inside one transaction, so two simultaneous calls for the same doctor cannot both succeed.
 * Sends nothing to anyone: no WhatsApp message, push, email or live event.
 */
async function setAppointmentQueueStatus(tenantId, bookingId, status, staff) {
  const fail = (message, code) => Object.assign(new Error(message), { queueError: true, status: code });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bRes = await client.query(
      `SELECT id, doctor_id, booking_type, status, arrived_at, consult_started_at,
              booking_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date AS is_today
       FROM bookings WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [bookingId, tenantId]
    );
    const booking = bRes.rows[0];
    if (!booking) throw fail('Booking not found', 404);
    if (staff?.role === 'doctor' && (!staff.doctor_id || booking.doctor_id !== staff.doctor_id)) {
      throw fail('You can only change your own schedule.', 403);
    }
    if (booking.booking_type !== 'appointment') throw fail('Token bookings use the token queue actions.', 400);
    if (!booking.is_today) throw fail("Only today's appointments can be moved in the queue.", 400);
    if (!['confirmed', 'pending'].includes(booking.status)) throw fail(`This booking is ${booking.status}.`, 400);

    if (status === 'in_consult' && !booking.consult_started_at) {
      // Serialise the "one in consult" check per doctor (appointment calls); today's rows only
      await client.query('SELECT id FROM clinic_doctors WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [booking.doctor_id, tenantId]);
      const busy = await client.query(
        `SELECT 1 FROM bookings x
         WHERE x.tenant_id = $1 AND x.doctor_id = $2 AND x.id <> $3
           AND x.booking_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
           AND x.booking_type = 'appointment' AND x.consult_started_at IS NOT NULL
           AND x.status NOT IN ('completed', 'noshow', 'cancelled')
         UNION ALL
         SELECT 1 FROM clinic_tokens t JOIN bookings tb ON tb.id = t.booking_id
         WHERE t.tenant_id = $1 AND t.doctor_id = $2 AND t.status = 'in_progress'
           AND tb.booking_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
         LIMIT 1`,
        [tenantId, booking.doctor_id, bookingId]
      );
      if (busy.rows.length) throw fail('This doctor already has a patient in consult.', 409);
    }

    // Transitions (current state is derived from the two columns: consult_started_at set = in consult, else arrived_at set = arrived, else waiting):
    //   to 'waiting':    clears arrived_at and consult_started_at (no-op when already waiting)
    //   to 'arrived':    from waiting sets arrived_at; from in consult clears consult_started_at and keeps arrived_at; no-op when already arrived
    //   to 'in_consult': sets consult_started_at (and arrived_at when empty); no-op when already in consult
    let updateSql = null;
    if (status === 'waiting') {
      if (booking.arrived_at || booking.consult_started_at) {
        updateSql = `UPDATE bookings SET arrived_at = NULL, consult_started_at = NULL, updated_at = NOW()
                     WHERE id = $1 AND tenant_id = $2 RETURNING id, arrived_at, consult_started_at`;
      }
    } else if (status === 'arrived') {
      if (booking.consult_started_at) {
        updateSql = `UPDATE bookings SET consult_started_at = NULL, arrived_at = COALESCE(arrived_at, NOW()), updated_at = NOW()
                     WHERE id = $1 AND tenant_id = $2 RETURNING id, arrived_at, consult_started_at`;
      } else if (!booking.arrived_at) {
        updateSql = `UPDATE bookings SET arrived_at = NOW(), updated_at = NOW()
                     WHERE id = $1 AND tenant_id = $2 RETURNING id, arrived_at, consult_started_at`;
      }
    } else if (!booking.consult_started_at) {
      updateSql = `UPDATE bookings SET consult_started_at = NOW(), arrived_at = COALESCE(arrived_at, NOW()), updated_at = NOW()
                   WHERE id = $1 AND tenant_id = $2 RETURNING id, arrived_at, consult_started_at`;
    }
    const row = updateSql
      ? (await client.query(updateSql, [bookingId, tenantId])).rows[0]
      : { id: booking.id, arrived_at: booking.arrived_at, consult_started_at: booking.consult_started_at };
    await client.query('COMMIT');
    return { ...row, queue_status: row.consult_started_at ? 'in_consult' : (row.arrived_at ? 'arrived' : 'waiting') };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Marks patient as no show
 *
 * @param {string} tenantId
 * @param {string} bookingId
 * @returns {Promise<object>}
 */
async function markNoShow(tenantId, bookingId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const bookingSql = `
      UPDATE bookings 
      SET status = 'noshow', updated_at = NOW() 
      WHERE tenant_id = $1 AND id = $2 
      RETURNING *
    `;
    const bookingRes = await tenantQuery(tenantId, client, bookingSql, [bookingId]);
    
    const tokenSql = `
      UPDATE clinic_tokens 
      SET status = 'cancelled' 
      WHERE tenant_id = $1 AND booking_id = $2
    `;
    await tenantQuery(tenantId, client, tokenSql, [bookingId]);

    await client.query('COMMIT');
    return bookingRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gets booking statistics for dashboard
 * Returns counts by status for today
 *
 * @param {string} tenantId
 * @returns {Promise<object>} {
 *   total, confirmed, completed,
 *   cancelled, noshow, pending
 * }
 */
async function getBookingStats(tenantId, doctorId = null) {
  const params = [tenantId];
  let sql = `
    SELECT status, COUNT(*) as count
    FROM bookings
    WHERE tenant_id = $1 AND booking_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
  `;
  if (doctorId) {
    params.push(doctorId);
    sql += ` AND doctor_id = $${params.length}`;
  }
  sql += ` GROUP BY status`;
  const result = await pool.query(sql, params);
  
  const stats = {
    total: 0,
    confirmed: 0,
    completed: 0,
    cancelled: 0,
    noshow: 0,
    pending: 0
  };

  result.rows.forEach(row => {
    const count = parseInt(row.count);
    stats.total += count;
    if (stats[row.status] !== undefined) {
      stats[row.status] = count;
    }
  });

  return stats;
}

module.exports = {
  createBookingWithToken,
  getBookingsDashboard,
  cancelBookingWithRules,
  completeBooking,
  markNoShow,
  setAppointmentQueueStatus,
  getBookingStats
};

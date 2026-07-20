const BookingService = require('./booking.service');
const BookingModel = require('./booking.model');
const { successResponse, errorResponse } = require('../../utils/response');
const pool = require('../../config/database');
const logger = require('../../utils/logger');

// UUID v4 format validation helper
const { sendMessage } = require('../channel/whatsapp/whatsapp.adapter')
const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
// Phone: 7–15 digits optionally prefixed with +
const isPhone = (str) => /^\+?\d{7,15}$/.test(str);

/**
 * GET /bookings
 * Gets bookings list with filters
 * Query params: date, status, doctorId, page, limit
 */
async function getBookings(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { date, status, customerId, page, limit, upcoming } = req.query;
    let { doctorId } = req.query;

    // If logged in as doctor, only show their own bookings
    if (req.staff.role === 'doctor' && req.staff.doctor_id) {
      doctorId = req.staff.doctor_id;
    }

    const result = await BookingService.getBookingsDashboard(tenantId, {
      date, status, doctorId, customerId, page, limit, upcoming: upcoming === 'true'
    });
    
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /bookings/stats
 * Gets today's booking statistics
 */
async function getBookingStats(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const doctorId = req.staff.role === 'doctor' && req.staff.doctor_id ? req.staff.doctor_id : null;
    const stats = await BookingService.getBookingStats(tenantId, doctorId);
    return successResponse(res, stats);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /bookings/:id
 * Gets single booking with full details
 */
async function getBookingById(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    
    const booking = await BookingModel.getBookingById(pool, tenantId, id);
    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }
    
    return successResponse(res, booking);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /bookings
 * Creates new booking (staff portal)
 */
async function createBooking(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const result = await BookingService.createBookingWithToken(tenantId, req.body);
    return successResponse(res, result, 201);
  } catch (error) {
    if (error.statusCode === 429) {
      return errorResponse(res, error.message, 429);
    }
    if (error.message.includes('not available') || error.message.includes('fully booked')) {
      return errorResponse(res, error.message, 400);
    }
    next(error);
  }
}

/**
 * PATCH /bookings/:id/status
 * Updates booking status
 */
async function updateBookingStatus(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    const { status } = req.body;
    
    const booking = await BookingModel.updateBookingStatus(pool, tenantId, id, status);
    if (!booking) {
      return errorResponse(res, 'Booking not found', 404);
    }
    
    return successResponse(res, booking);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /bookings/:id/cancel
 * Cancels a booking
 */
async function cancelBooking(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    
    const booking = await BookingService.cancelBookingWithRules(tenantId, id, 'staff');
    return successResponse(res, booking);
  } catch (error) {
    if (error.message.includes('Cannot cancel')) {
      return errorResponse(res, error.message, 400);
    }
    next(error);
  }
}

/**
 * POST /bookings/:id/complete
 * Marks booking as completed
 */
async function completeBooking(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    
    const booking = await BookingService.completeBooking(tenantId, id);
    return successResponse(res, booking);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /bookings/:id/noshow
 * Marks patient as no show
 */
async function markNoShow(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    
    const booking = await BookingService.markNoShow(tenantId, id);
    return successResponse(res, booking);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /bookings/today
 * Gets all bookings for today specifically
 * Used by token queue display
 */
async function getTodayBookings(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const sql = `
      SELECT b.id, b.token_number, b.status, b.source, b.booking_date, b.created_at,
             c.name as patient_name, c.phone as patient_phone, 
             d.name as doctor_name
      FROM bookings b
      LEFT JOIN customers c ON b.customer_id = c.id
      LEFT JOIN clinic_doctors d ON b.doctor_id = d.id
      WHERE b.tenant_id = $1 AND b.booking_date = CURRENT_DATE
      ORDER BY b.token_number ASC
    `;
    const result = await pool.query(sql, [tenantId]);
    return successResponse(res, result.rows);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /bookings/export
 * Exports bookings as CSV
 * Query params: startDate, endDate
 * Returns CSV string
 */
async function exportBookings(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { startDate, endDate } = req.query;
    
    let sql = `
      SELECT b.token_number, c.name as patient_name, c.phone, d.name as doctor_name, b.status, b.booking_date
      FROM bookings b
      LEFT JOIN customers c ON b.customer_id = c.id
      LEFT JOIN clinic_doctors d ON b.doctor_id = d.id
      WHERE b.tenant_id = $1
    `;
    const params = [tenantId];
    if (startDate) {
      params.push(startDate);
      sql += ` AND b.booking_date >= $${params.length}`;
    }
    if (endDate) {
      params.push(endDate);
      sql += ` AND b.booking_date <= $${params.length}`;
    }
    
    const result = await pool.query(sql, params);
    
    const escCsv = (v) => `"${String(v ?? '').replace(/\"/g, '""')}"`;
    let csv = '"Token","Patient Name","Phone","Doctor","Status","Date"\n';
    for (const row of result.rows) {
      const d = row.booking_date.toISOString().split('T')[0];
      csv += `${escCsv(row.token_number)},${escCsv(row.patient_name)},${escCsv(row.phone)},${escCsv(row.doctor_name)},${escCsv(row.status)},${escCsv(d)}\n`;
    }
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bookings_export.csv"');
    return res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /bookings/manual
 * Staff creates booking manually.
 * All DB writes are wrapped in a transaction.
 * A FOR UPDATE lock on the doctor row serialises concurrent
 * token-number assignments, preventing duplicates.
 */
async function createManualBooking(req, res, next) {
  const tenantId = req.tenant.id;
  const { patientName, patientPhone, notes, bookingDate, sendWhatsapp, isPresent, slot_time } = req.body
  const doctorId = req.staff?.role === 'doctor' && req.staff?.doctor_id
    ? req.staff.doctor_id
    : req.body.doctorId

  // Normalize phone to +91XXXXXXXXXX format
  const normalizedPhone = (() => {
    const digits = (patientPhone || '').replace(/\D/g, '');
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
    if (digits.length === 13 && digits.startsWith('91')) return `+${digits.slice(1)}`;
    return `+${digits}`;
  })();

  const cleanPatientName = (patientName || '').trim().replace(/<[^>]*>/g, '').slice(0, 255) || 'Unknown Patient';
  const cleanNotes = (notes || '').trim().replace(/<[^>]*>/g, '').slice(0, 2000);

  if (!patientPhone || !doctorId) {
    return errorResponse(res, 'Patient phone and doctor ID are required', 400);
  }
  if (!isPhone(normalizedPhone)) {
    return errorResponse(res, 'Invalid phone number format', 400);
  }
  if (!isUUID(doctorId)) {
    return errorResponse(res, 'Invalid doctor ID', 400);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the doctor row for this transaction to prevent concurrent
    // bookings from computing the same token number.
    const doctorCheck = await client.query(
      'SELECT id FROM clinic_doctors WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [doctorId, tenantId]
    );
    if (!doctorCheck.rows.length) {
      await client.query('ROLLBACK');
      return errorResponse(res, 'Doctor not found', 404);
    }

    // Check for duplicate booking — same phone, same doctor, same day
    const targetDate = bookingDate || new Date().toISOString().split('T')[0];
    const dupCheck = await client.query(
      `SELECT b.id, b.token_number FROM bookings b
       JOIN customers c ON c.id = b.customer_id
       WHERE b.tenant_id = $1 AND b.doctor_id = $2 AND b.booking_date = $3
       AND c.phone = $4 AND b.status NOT IN ('cancelled', 'completed')
       LIMIT 1`,
      [tenantId, doctorId, targetDate, normalizedPhone]
    );
    if (dupCheck.rows.length) {
      await client.query('ROLLBACK');
      return errorResponse(res, `This patient already has Token #${dupCheck.rows[0].token_number} with this doctor today`, 409);
    }

    // Find or create customer
    let cusRes = await client.query(
      'SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2 LIMIT 1',
      [tenantId, normalizedPhone]
    );
    let customerId;
    if (cusRes.rows.length > 0) {
      customerId = cusRes.rows[0].id;
    } else {
      const pName = cleanPatientName;
      const insertCus = await client.query(
        'INSERT INTO customers (tenant_id, phone, name) VALUES ($1, $2, $3) RETURNING id',
        [tenantId, normalizedPhone, pName]
      );
      customerId = insertCus.rows[0].id;
    }

    // Find or create patient record
    let patientId = null;
    const patientNameClean = cleanPatientName;
    if (customerId) {
      try {
        const existingPatient = await client.query(
          `SELECT id FROM patients WHERE tenant_id = $1 AND customer_id = $2 AND LOWER(name) = LOWER($3)`,
          [tenantId, customerId, patientNameClean]
        );
        if (existingPatient.rows.length > 0) {
          patientId = existingPatient.rows[0].id;
        } else {
          const newPatient = await client.query(
            `INSERT INTO patients (tenant_id, customer_id, name, phone)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (tenant_id, customer_id, LOWER(name)) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [tenantId, customerId, patientNameClean, normalizedPhone]
          );
          patientId = newPatient.rows[0]?.id || null;
        }
      } catch (patientErr) {
        logger.warn('Patient find-or-create failed in manual booking (non-fatal):', patientErr.message, patientErr.code, patientErr.detail);
        patientId = null;
      }
    }

    // Count existing tokens inside the locked transaction — no race condition
    const tokenCountResult = await client.query(
      `SELECT COALESCE(MAX(token_number), 0) AS max_token
       FROM bookings
       WHERE doctor_id = $1
       AND booking_date = $2
       AND status != 'cancelled'
       AND tenant_id = $3`,
      [doctorId, bookingDate || new Date().toISOString().split('T')[0], tenantId]
    );
    const tokenNumber = parseInt(tokenCountResult.rows[0].max_token) + 1;

    // Insert booking
    const bRes = await client.query(
      `INSERT INTO bookings
         (tenant_id, customer_id, doctor_id, source, status, booking_date, token_number, notes, patient_name, patient_id, slot_time)
       VALUES ($1, $2, $3, 'walkin', 'pending', $8, $4, $5, $6, $7, $9)
       RETURNING *`,
      [tenantId, customerId, doctorId, tokenNumber, cleanNotes, patientNameClean, patientId, bookingDate || new Date().toISOString().split('T')[0], slot_time || null]
    );
    const booking = bRes.rows[0];

    // Insert clinic_token record
    await client.query(
      `INSERT INTO clinic_tokens (tenant_id, booking_id, doctor_id, token_number, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, booking.id, doctorId, tokenNumber, isPresent ? 'arrived' : 'waiting']
    );

    await client.query('COMMIT');

    // Fetch doctor name outside the transaction (read-only, no locking needed)
    const docRes = await pool.query('SELECT name FROM clinic_doctors WHERE id = $1', [doctorId]);
    booking.patient_phone = normalizedPhone;
    booking.doctor_name = docRes.rows[0]?.name;
    // Send WhatsApp confirmation in background only if requested
    if (sendWhatsapp) {
      setImmediate(async () => {
        try {
          const { sendTemplateMessage } = require('../channel/whatsapp/whatsapp.adapter')
          await sendTemplateMessage(normalizedPhone, 'appointment_confirmation', 'en', [])
        } catch (waErr) {
          logger.warn('WhatsApp confirmation failed for manual booking:', waErr.message)
        }
      })
    }
    return successResponse(res, booking, 201);
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
}

module.exports = {
  getBookings,
  getBookingStats,
  getBookingById,
  createBooking,
  updateBookingStatus,
  cancelBooking,
  completeBooking,
  markNoShow,
  getTodayBookings,
  exportBookings,
  createManualBooking
};

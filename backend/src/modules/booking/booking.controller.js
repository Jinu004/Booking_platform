const BookingService = require('./booking.service');
const BookingModel = require('./booking.model');
const { successResponse, errorResponse } = require('../../utils/response');
const pool = require('../../config/database');

/**
 * GET /bookings
 * Gets bookings list with filters
 * Query params: date, status, doctorId, page, limit
 */
async function getBookings(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { date, status, doctorId, customerId, page, limit } = req.query;
    
    const result = await BookingService.getBookingsDashboard(tenantId, {
      date, status, doctorId, customerId, page, limit
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
    const stats = await BookingService.getBookingStats(tenantId);
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
    const today = new Date().toISOString().split('T')[0];
    const result = await BookingService.getBookingsDashboard(tenantId, { date: today, limit: 100 });
    return successResponse(res, result);
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
    
    let csv = 'Token,Patient Name,Phone,Doctor,Status,Date\\n';
    for (const row of result.rows) {
      const d = row.booking_date.toISOString().split('T')[0];
      csv += `${row.token_number},${row.patient_name || ''},${row.phone},${row.doctor_name || ''},${row.status},${d}\\n`;
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
 * Staff creates booking manually
 */
async function createManualBooking(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { patientName, patientPhone, doctorId, notes } = req.body;
    
    if (!patientPhone || !doctorId) {
      return errorResponse(res, 'Patient phone and doctor ID are required', 400);
    }

    let cusRes = await pool.query('SELECT id FROM customers WHERE tenant_id = $1 AND phone = $2 LIMIT 1', [tenantId, patientPhone]);
    let customerId;
    if (cusRes.rows.length > 0) {
      customerId = cusRes.rows[0].id;
    } else {
      const pName = patientName || 'Unknown Patient';
      const insertCus = await pool.query(
        'INSERT INTO customers (tenant_id, phone, name) VALUES ($1, $2, $3) RETURNING id',
        [tenantId, patientPhone, pName]
      );
      customerId = insertCus.rows[0].id;
    }

    const today = new Date().toISOString().split('T')[0];
    const tokRes = await pool.query(
      'SELECT COALESCE(MAX(token_number), 0) + 1 as nxt FROM bookings WHERE tenant_id = $1 AND doctor_id = $2 AND booking_date = $3',
      [tenantId, doctorId, today]
    );
    const token = parseInt(tokRes.rows[0].nxt, 10);

    const bRes = await pool.query(
      `INSERT INTO bookings (tenant_id, customer_id, doctor_id, source, status, booking_date, token_number, notes)
       VALUES ($1, $2, $3, 'walkin', 'pending', $4, $5, $6) RETURNING *`,
       [tenantId, customerId, doctorId, today, token, notes || '']
    );

    return successResponse(res, bRes.rows[0], 201);
  } catch (error) {
    next(error);
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

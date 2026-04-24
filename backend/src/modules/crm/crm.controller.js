const CRMService = require('./crm.service');
const CRMModel = require('./crm.model');
const pool = require('../../config/database');
const { successResponse, errorResponse } = require('../../utils/response');
const logger = require('../../utils/logger');

/**
 * GET /customers
 * Lists all customers with search and pagination
 * Query params: search, page, limit
 */
async function getCustomers(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { search, page, limit } = req.query;
    const result = await CRMService.searchCustomers(tenantId, { search, page, limit });
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /customers/:id
 * Gets customer profile with visit history
 */
async function getCustomerById(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    const profile = await CRMService.getCustomerProfile(tenantId, id);
    return successResponse(res, profile);
  } catch (error) {
    if (error.message === 'Customer not found') {
      return errorResponse(res, error.message, 404);
    }
    next(error);
  }
}

/**
 * POST /customers
 * Creates customer manually (staff portal)
 */
async function createCustomer(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const customer = await CRMModel.upsertCustomer(pool, tenantId, req.body);
    return successResponse(res, customer, 201);
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /customers/:id
 * Updates customer info or notes
 */
async function updateCustomer(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    const customer = await CRMModel.updateCustomer(pool, tenantId, id, req.body);
    if (!customer) {
      return errorResponse(res, 'Customer not found', 404);
    }
    return successResponse(res, customer);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /customers/:id/history
 * Gets customer booking history
 */
async function getCustomerHistory(req, res, next) {
  try {
    const tenantId = req.tenant.id;
    const { id } = req.params;
    const history = await CRMModel.getCustomerHistory(pool, tenantId, id);
    return successResponse(res, history);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /crm/search?q=query
 * Global search across patients and bookings
 * Searches by patient name or phone number
 */
async function globalSearch(req, res) {
  try {
    const tenantId = req.tenant.id
    const { q } = req.query

    if (!q || q.trim().length < 2) {
      return successResponse(res, {
        patients: [],
        bookings: []
      })
    }

    const searchTerm = q.trim()

    // Search patients by name or phone
    const patientsResult = await pool.query(
      `SELECT id, name, phone, last_seen,
              created_at
       FROM customers
       WHERE tenant_id = $1
       AND (
         LOWER(name) LIKE LOWER($2)
         OR phone LIKE $2
       )
       ORDER BY name ASC
       LIMIT 5`,
      [tenantId, `%${searchTerm}%`]
    )

    // Search recent bookings by patient name or phone
    const bookingsResult = await pool.query(
      `SELECT b.id, b.token_number,
              b.booking_date, b.status,
              b.source,
              c.name AS patient_name,
              c.phone AS patient_phone,
              cd.name AS doctor_name
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
       JOIN clinic_doctors cd ON cd.id = b.doctor_id
       WHERE b.tenant_id = $1
       AND (
         LOWER(c.name) LIKE LOWER($2)
         OR c.phone LIKE $2
       )
       ORDER BY b.booking_date DESC
       LIMIT 5`,
      [tenantId, `%${searchTerm}%`]
    )

    return successResponse(res, {
      patients: patientsResult.rows,
      bookings: bookingsResult.rows
    })
  } catch (err) {
    logger.error('Global search error:', err.message)
    return errorResponse(res, 'Search failed')
  }
}

module.exports = {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  getCustomerHistory,
  globalSearch
};

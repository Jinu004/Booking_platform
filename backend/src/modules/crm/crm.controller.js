const CRMService = require('./crm.service');
const CRMModel = require('./crm.model');
const pool = require('../../config/database');
const { successResponse, errorResponse } = require('../../utils/response');

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

module.exports = {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  getCustomerHistory
};

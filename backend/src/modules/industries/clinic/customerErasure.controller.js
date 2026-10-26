const pool = require('../../../config/database');
const { successResponse, errorResponse } = require('../../../utils/response');
const logger = require('../../../utils/logger');
const { eraseCustomer, previewCustomerErasure, ErasureError } = require('./customerErasure.service');

const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

// The clinic comes from the logged-in user only, never from the request
const tenantOf = (req) => req.tenantId || req.tenant?.id;

/**
 * GET /clinic/customers/:id/erase-preview   (admin and super_admin only, see the route)
 * Read-only: the customer's name and phone and the counts of what an erasure would remove.
 */
async function getErasePreview(req, res, next) {
  // The connection is taken inside the try: a pool failure then answers through next(err) instead of an unhandled rejection,
  // and the client is released only when one was obtained
  let client = null;
  try {
    const { id } = req.params;
    if (!isUUID(id)) return errorResponse(res, 'Invalid customer ID', 400);
    client = await pool.connect();
    const preview = await previewCustomerErasure(client, tenantOf(req), id);
    return successResponse(res, preview);
  } catch (err) {
    if (err instanceof ErasureError) return errorResponse(res, err.message, err.statusCode);
    next(err);
  } finally {
    if (client) client.release();
  }
}

/**
 * POST /clinic/customers/:id/erase   (admin and super_admin only, see the route)
 * Body: { confirm: "DELETE", keepMedicalNotes?: boolean (default false) }
 */
async function eraseCustomerData(req, res, next) {
  let client = null;
  try {
    const { id } = req.params;
    if (!isUUID(id)) return errorResponse(res, 'Invalid customer ID', 400);
    const { confirm, keepMedicalNotes } = req.body || {};
    if (confirm !== 'DELETE') return errorResponse(res, 'Type DELETE to confirm the erasure', 400);
    if (keepMedicalNotes !== undefined && typeof keepMedicalNotes !== 'boolean') {
      return errorResponse(res, 'keepMedicalNotes must be true or false', 400);
    }
    client = await pool.connect();
    const result = await eraseCustomer(client, {
      tenantId: tenantOf(req),
      customerId: id,
      staffId: req.staff?.id || null,
      keepMedicalNotes: keepMedicalNotes === true,
      ipAddress: req.ip
    });
    return successResponse(res, result);
  } catch (err) {
    if (err instanceof ErasureError) return errorResponse(res, err.message, err.statusCode);
    logger.error(`CUSTOMER_ERASURE failed class=${String((err && (err.name || err.code)) || 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40)}`);
    next(err);
  } finally {
    if (client) client.release();
  }
}

module.exports = { getErasePreview, eraseCustomerData };

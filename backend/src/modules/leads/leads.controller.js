const pool = require('../../config/database')
const { successResponse, errorResponse } = require('../../utils/response')
const logger = require('../../utils/logger')

async function listLeads(req, res, next) {
  try {
    const result = await pool.query(
      'SELECT * FROM leads WHERE tenant_id = $1 ORDER BY created_at DESC',
      [req.tenantId]
    )
    return successResponse(res, result.rows)
  } catch (err) {
    logger.error('listLeads failed:', err.message)
    next(err)
  }
}

async function createLead(req, res, next) {
  try {
    const { customer_phone, customer_name, product_id, product_name, quantity, delivery_address, alt_phone, notes } = req.body
    if (!customer_phone) {
      return errorResponse(res, 'customer_phone is required', 400)
    }
    const result = await pool.query(
      'INSERT INTO leads (tenant_id, customer_phone, customer_name, product_id, product_name, quantity, delivery_address, alt_phone, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [req.tenantId, customer_phone, customer_name || '', product_id || '', product_name || '', quantity || 1, delivery_address || '', alt_phone || '', notes || '']
    )
    return successResponse(res, result.rows[0], 201)
  } catch (err) {
    logger.error('createLead failed:', err.message)
    next(err)
  }
}

async function updateLeadStatus(req, res, next) {
  try {
    const { id } = req.params
    const { status } = req.body
    if (!status) {
      return errorResponse(res, 'status is required', 400)
    }
    const allowed = ['new', 'confirmed', 'printing', 'ready', 'shipped', 'delivered', 'cancelled']
    if (!allowed.includes(status)) {
      return errorResponse(res, 'Invalid status', 400)
    }
    const result = await pool.query(
      'UPDATE leads SET status = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *',
      [status, id, req.tenantId]
    )
    if (!result.rows.length) {
      return errorResponse(res, 'Lead not found', 404)
    }
    return successResponse(res, result.rows[0])
  } catch (err) {
    logger.error('updateLeadStatus failed:', err.message)
    next(err)
  }
}


async function updateOrderPayment(req, res, next) {
  try {
    const { id } = req.params
    const { payment_status, payment_method } = req.body
    const allowed_status = ['unpaid', 'paid', 'cod']
    const allowed_method = ['upi', 'cash', 'bank_transfer', 'cod', '']
    if (payment_status && !allowed_status.includes(payment_status)) {
      return errorResponse(res, 'Invalid payment status', 400)
    }
    if (payment_method !== undefined && !allowed_method.includes(payment_method)) {
      return errorResponse(res, 'Invalid payment method', 400)
    }
    const result = await pool.query(
      `UPDATE leads SET 
        payment_status = COALESCE($1, payment_status),
        payment_method = COALESCE($2, payment_method)
       WHERE id = $3 AND tenant_id = $4 RETURNING *`,
      [payment_status || null, payment_method !== undefined ? payment_method : null, id, req.tenantId]
    )
    if (!result.rows.length) return errorResponse(res, 'Order not found', 404)
    return successResponse(res, result.rows[0])
  } catch (err) {
    logger.error('updateOrderPayment failed:', err.message)
    next(err)
  }
}

async function updateOrderNotes(req, res, next) {
  try {
    const { id } = req.params
    const { internal_notes } = req.body
    const result = await pool.query(
      'UPDATE leads SET internal_notes = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *',
      [internal_notes || '', id, req.tenantId]
    )
    if (!result.rows.length) return errorResponse(res, 'Order not found', 404)
    return successResponse(res, result.rows[0])
  } catch (err) {
    logger.error('updateOrderNotes failed:', err.message)
    next(err)
  }
}

async function updateOrderTracking(req, res, next) {
  try {
    const { id } = req.params
    const { tracking_id } = req.body
    const result = await pool.query(
      'UPDATE leads SET tracking_id = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *',
      [tracking_id || '', id, req.tenantId]
    )
    if (!result.rows.length) return errorResponse(res, 'Order not found', 404)
    return successResponse(res, result.rows[0])
  } catch (err) {
    logger.error('updateOrderTracking failed:', err.message)
    next(err)
  }
}

module.exports = { listLeads, createLead, updateLeadStatus, updateOrderPayment, updateOrderNotes, updateOrderTracking }

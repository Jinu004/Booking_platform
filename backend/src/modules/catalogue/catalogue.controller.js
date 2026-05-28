const pool = require('../../config/database')
const { successResponse, errorResponse } = require('../../utils/response')
const logger = require('../../utils/logger')

async function listItems(req, res, next) {
  try {
    const result = await pool.query(
      'SELECT * FROM catalogue_items WHERE tenant_id = $1 ORDER BY name ASC',
      [req.tenantId]
    )
    return successResponse(res, result.rows)
  } catch (err) {
    logger.error('listItems failed:', err.message)
    next(err)
  }
}

async function createItem(req, res, next) {
  try {
    const { product_id, name, description, price, in_stock } = req.body
    if (!product_id || !name) {
      return errorResponse(res, 'product_id and name are required', 400)
    }
    const result = await pool.query(
      'INSERT INTO catalogue_items (tenant_id, product_id, name, description, price, in_stock) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.tenantId, product_id, name, description || '', price || 0, in_stock !== false]
    )
    return successResponse(res, result.rows[0], 201)
  } catch (err) {
    if (err.code === '23505') {
      return errorResponse(res, 'A product with this product_id already exists', 409)
    }
    logger.error('createItem failed:', err.message)
    next(err)
  }
}

async function updateItem(req, res, next) {
  try {
    const { id } = req.params
    const { name, description, price, in_stock } = req.body
    const result = await pool.query(
      'UPDATE catalogue_items SET name = COALESCE($1, name), description = COALESCE($2, description), price = COALESCE($3, price), in_stock = COALESCE($4, in_stock), updated_at = NOW() WHERE id = $5 AND tenant_id = $6 RETURNING *',
      [name || null, description !== undefined ? description : null, price !== undefined ? price : null, in_stock !== undefined ? in_stock : null, id, req.tenantId]
    )
    if (!result.rows.length) {
      return errorResponse(res, 'Item not found', 404)
    }
    return successResponse(res, result.rows[0])
  } catch (err) {
    logger.error('updateItem failed:', err.message)
    next(err)
  }
}

async function deleteItem(req, res, next) {
  try {
    const { id } = req.params
    const result = await pool.query(
      'DELETE FROM catalogue_items WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [id, req.tenantId]
    )
    if (!result.rows.length) {
      return errorResponse(res, 'Item not found', 404)
    }
    return successResponse(res, { deleted: true })
  } catch (err) {
    logger.error('deleteItem failed:', err.message)
    next(err)
  }
}

module.exports = { listItems, createItem, updateItem, deleteItem }

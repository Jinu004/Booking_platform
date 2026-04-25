const { verifyToken } = require('../../config/auth')
const pool = require('../../config/database')
const logger = require('../../utils/logger')
const {
  errorResponse
} = require('../../utils/response')
const env = require('../../config/env')

/**
 * requireAuth middleware
 * Validates JWT token from Authorization header
 * Sets req.staff and req.tenant on success
 */
async function requireAuth(req, res, next) {
  try {
    // Bypass mode for development only
    if (env.BYPASS_AUTH === 'true' &&
        env.NODE_ENV === 'development') {
      const tenantId = req.headers['x-dev-tenant-id']
      const role = req.headers['x-dev-role']
        || 'admin'

      if (tenantId) {
        const tenantResult = await pool.query(
          `SELECT * FROM tenants WHERE id = $1`,
          [tenantId]
        )
        if (tenantResult.rows.length) {
          req.tenant = tenantResult.rows[0]
          req.staff = {
            id: 'dev-staff-id',
            name: 'Dev User',
            email: 'dev@receptionai.in',
            role,
            tenantId
          }
          req.tenantId = tenantId
          return next()
        }
      }
      return errorResponse(res,
        'Dev mode: x-dev-tenant-id required', 401)
    }

    // Production auth — validate JWT
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse(res,
        'Authentication required', 401)
    }

    const token = authHeader.replace('Bearer ', '')

    // Verify JWT
    let decoded
    try {
      decoded = verifyToken(token)
    } catch (err) {
      return errorResponse(res,
        'Invalid or expired token', 401)
    }

    // Check session exists in database
    const sessionResult = await pool.query(
      `SELECT s.*, t.name AS tenant_name,
              t.plan AS tenant_plan,
              t.status AS tenant_status,
              t.whatsapp_number
       FROM auth_sessions ses
       JOIN staff s ON s.id = ses.staff_id
       JOIN tenants t ON t.id = ses.tenant_id
       WHERE ses.token = $1
       AND ses.expires_at > NOW()`,
      [token]
    )

    if (!sessionResult.rows.length) {
      return errorResponse(res,
        'Session expired. Please login again.',
        401)
    }

    const staffData = sessionResult.rows[0]

    // Check tenant is active
    if (staffData.tenant_status === 'suspended') {
      return errorResponse(res,
        'Account suspended', 403)
    }

    // Set req.staff and req.tenant
    req.staff = {
      id: staffData.id,
      name: staffData.name,
      email: staffData.email,
      role: staffData.role,
      tenantId: staffData.tenant_id
    }

    req.tenant = {
      id: staffData.tenant_id,
      name: staffData.tenant_name,
      plan: staffData.tenant_plan,
      status: staffData.tenant_status,
      whatsapp_number: staffData.whatsapp_number
    }

    req.tenantId = staffData.tenant_id

    next()
  } catch (err) {
    logger.error('Auth middleware error:',
      err.message)
    return errorResponse(res,
      'Authentication failed', 401)
  }
}

module.exports = { requireAuth }

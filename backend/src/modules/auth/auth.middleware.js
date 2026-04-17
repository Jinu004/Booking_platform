const { errorResponse } = require('../../utils/response')
const logger = require('../../utils/logger')

/**
 * Requires authenticated staff member
 * Development: reads x-dev-role header
 * Production: verifies Clerk JWT
 *
 * Attaches to req:
 * req.staff = { id, tenantId, role, email }
 * req.tenantId = string
 * req.isBypass = boolean
 */
async function requireAuth(req, res, next) {
  try {
    const bypassAuth = process.env.BYPASS_AUTH === 'true'

    if (bypassAuth) {
      const role = req.headers['x-dev-role']
      const tenantId = req.headers['x-dev-tenant-id']

      if (!role || !tenantId) {
        return errorResponse(
          res,
          'Dev bypass requires x-dev-role and x-dev-tenant-id headers',
          401
        )
      }

      req.staff = {
        id: 'dev-staff-id',
        tenantId,
        role,
        email: 'dev@bookingplatform.com'
      }
      req.tenantId = tenantId
      req.isBypass = true
      return next()
    }

    // Production: verify Clerk JWT
    // Import Clerk SDK
    const { clerkClient } = require('@clerk/clerk-sdk-node')

    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse(res, 'No authorization token', 401)
    }

    const token = authHeader.split(' ')[1]

    try {
      const payload = await clerkClient.verifyToken(token)
      const userId = payload.sub

      // Get staff record from database
      const pool = require('../../config/database')
      const result = await pool.query(
        `SELECT s.*, t.id as tenant_id
         FROM staff s
         JOIN tenants t ON t.id = s.tenant_id
         WHERE s.clerk_user_id = $1
         AND s.is_active = true`,
        [userId]
      )

      if (!result.rows[0]) {
        return errorResponse(res, 'Staff not found', 401)
      }

      const staff = result.rows[0]
      req.staff = {
        id: staff.id,
        tenantId: staff.tenant_id,
        role: staff.role,
        email: staff.email
      }
      req.tenantId = staff.tenant_id
      req.isBypass = false
      return next()
    } catch (err) {
      logger.error('Token verification failed:', err.message)
      return errorResponse(res, 'Invalid token', 401)
    }

  } catch (err) {
    logger.error('Auth middleware error:', err.message)
    return errorResponse(res, 'Authentication failed', 500)
  }
}

/**
 * Requires specific role
 * Use after requireAuth middleware
 *
 * @param {...string} roles - Allowed roles
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.staff) {
      return errorResponse(res, 'Not authenticated', 401)
    }

    if (!roles.includes(req.staff.role)) {
      return errorResponse(
        res,
        `Required role: ${roles.join(' or ')}`,
        403
      )
    }

    next()
  }
}

/**
 * Loads full tenant context
 * Must run after requireAuth
 * Attaches req.tenant object
 */
async function loadTenant(req, res, next) {
  try {
    const TenantService = require('../tenant/tenant.service')
    const tenant = await TenantService
      .getTenantById(req.tenantId)

    if (!tenant) {
      return errorResponse(res, 'Tenant not found', 404)
    }

    req.tenant = tenant
    next()
  } catch (err) {
    logger.error('Load tenant error:', err.message)
    return errorResponse(res, 'Failed to load tenant', 500)
  }
}

module.exports = { requireAuth, requireRole, loadTenant }

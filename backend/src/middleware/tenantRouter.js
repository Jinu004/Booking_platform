const logger = require('../utils/logger')

/**
 * Middleware that loads and attaches tenant from x-tenant-id header
 * or from the authenticated user's clerkId.
 *
 * Used by API routes that need tenant context.
 * The webhook handler identifies tenants differently (by WhatsApp number).
 *
 * Falls back to a dev bypass tenant if BYPASS_AUTH is set and
 * x-dev-tenant-id header is provided.
 *
 * @param {object} req
 * @param {object} res
 * @param {Function} next
 */
async function tenantRouter(req, res, next) {
  const TenantService = require('../modules/tenant/tenant.service')

  // Dev bypass mode
  if (process.env.BYPASS_AUTH === 'true') {
    const devTenantId = req.headers['x-dev-tenant-id']
    if (devTenantId) {
      try {
        const tenant = await TenantService.getTenantById(devTenantId)
        req.tenant = tenant
        return next()
      } catch (err) {
        logger.warn(`Dev tenant not found: ${devTenantId}`)
      }
    }
    // No tenant header in bypass mode — allow route to decide
    return next()
  }

  // Production mode — get tenant from authenticated user's organisation
  if (!req.auth?.userId) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }

  // In production this would look up user→tenant mapping from Clerk org or DB
  // Placeholder until Clerk auth middleware is fully wired
  const tenantId = req.headers['x-tenant-id']
  if (!tenantId) {
    return res.status(400).json({ success: false, error: 'Tenant ID required' })
  }

  try {
    const tenant = await TenantService.getTenantById(tenantId)
    req.tenant = tenant
    next()
  } catch (err) {
    logger.warn(`Tenant not found: ${tenantId}`)
    return res.status(404).json({ success: false, error: 'Tenant not found' })
  }
}

module.exports = tenantRouter

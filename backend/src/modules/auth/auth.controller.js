const { successResponse, errorResponse } = require('../../utils/response')
const { PERMISSIONS } = require('./auth.permissions')
const logger = require('../../utils/logger')

/**
 * GET /auth/me
 * Returns current staff member info and their permissions
 */
async function getMe(req, res) {
  try {
    const staff = req.staff;
    const permissions = Object.entries(PERMISSIONS).reduce((acc, [key, roles]) => {
      acc[key] = roles.includes(staff.role);
      return acc;
    }, {});

    return successResponse(res, {
      user: staff,
      tenant: req.tenant,
      permissions
    });
  } catch (error) {
    logger.error('Error in getMe:', error.message);
    return errorResponse(res, 'Failed to fetch user context', 500);
  }
}

/**
 * POST /auth/verify
 * Verifies token is valid and returns staff/tenant info
 */
async function verifyToken(req, res) {
  try {
    // The requireAuth and loadTenant middlewares have already validated the token
    // so we can just return the populated staff and tenant context
    return successResponse(res, {
      valid: true,
      user: req.staff,
      tenant: req.tenant
    });
  } catch (error) {
    logger.error('Error in verifyToken:', error.message);
    return errorResponse(res, 'Token verification failed', 500);
  }
}

/**
 * GET /auth/permissions
 * Returns boolean map of permissions for the current user's role
 */
async function getPermissions(req, res) {
  try {
    const role = req.staff.role;
    
    const contextPermissions = {};
    for (const [permKey, roles] of Object.entries(PERMISSIONS)) {
      contextPermissions[permKey] = roles.includes(role);
    }
    
    return successResponse(res, {
      role,
      permissions: contextPermissions
    });
  } catch (error) {
    logger.error('Error in getPermissions:', error.message);
    return errorResponse(res, 'Failed to fetch permissions', 500);
  }
}

module.exports = { getMe, verifyToken, getPermissions }

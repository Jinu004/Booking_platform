/**
 * Role hierarchy for the platform
 *
 * super_admin → full platform access
 * admin → full tenant access
 * manager → manage bookings and staff
 * receptionist → manage bookings only
 * doctor → view own schedule only
 */

const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  MANAGER: 'manager',
  RECEPTIONIST: 'receptionist',
  DOCTOR: 'doctor'
}

const PERMISSIONS = {
  // Tenant management
  MANAGE_TENANT: [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  VIEW_TENANT: [
    ROLES.SUPER_ADMIN, ROLES.ADMIN,
    ROLES.MANAGER, ROLES.RECEPTIONIST
  ],

  // Staff management
  MANAGE_STAFF: [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  VIEW_STAFF: [
    ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MANAGER
  ],

  // Booking management
  MANAGE_BOOKINGS: [
    ROLES.SUPER_ADMIN, ROLES.ADMIN,
    ROLES.MANAGER, ROLES.RECEPTIONIST
  ],
  VIEW_BOOKINGS: [
    ROLES.SUPER_ADMIN, ROLES.ADMIN,
    ROLES.MANAGER, ROLES.RECEPTIONIST, ROLES.DOCTOR
  ],

  // Customer management
  MANAGE_CUSTOMERS: [
    ROLES.SUPER_ADMIN, ROLES.ADMIN,
    ROLES.MANAGER, ROLES.RECEPTIONIST
  ],

  // Analytics
  VIEW_ANALYTICS: [
    ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MANAGER
  ],

  // Conversations
  VIEW_CONVERSATIONS: [
    ROLES.SUPER_ADMIN, ROLES.ADMIN,
    ROLES.MANAGER, ROLES.RECEPTIONIST
  ],
  TAKEOVER_CONVERSATIONS: [
    ROLES.SUPER_ADMIN, ROLES.ADMIN,
    ROLES.MANAGER, ROLES.RECEPTIONIST
  ]
}

/**
 * Checks if role has permission
 * @param {string} role
 * @param {string} permission
 * @returns {boolean}
 */
function hasPermission(role, permission) {
  const allowed = PERMISSIONS[permission]
  if (!allowed) return false
  return allowed.includes(role)
}

module.exports = { ROLES, PERMISSIONS, hasPermission }

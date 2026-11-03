const StaffService = require('./staff.service')
const StaffModel = require('./staff.model')
const pool = require('../../config/database')
const { successResponse, errorResponse } = require('../../utils/response')
const { bcrypt } = require('../../config/auth')
const { sendWelcomeEmail } = require('../../utils/email')
const { logAction } = require('../../utils/audit')
const { doctorLimitFor } = require('../../config/plans')

function generateTempPassword() {
  // crypto.randomBytes is cryptographically secure, unlike Math.random()
  const crypto = require('crypto');
  return crypto.randomBytes(12).toString('base64url');
}

/**
 * GET /staff
 */
async function getStaff(req, res, next) {
  try {
    const staff = await StaffService.getStaffWithStats(req.tenantId)
    return successResponse(res, { staff })
  } catch (error) {
    next(error)
  }
}

/**
 * GET /staff/:id
 */
async function getStaffById(req, res, next) {
  try {
    const staff = await StaffModel.getStaffById(pool, req.tenantId, req.params.id)
    if (!staff) {
      return errorResponse(res, 'Staff member not found', 404)
    }
    const { password_hash: _ph1, ...safeStaff1 } = staff;
    return successResponse(res, { staff: safeStaff1 })
  } catch (error) {
    next(error)
  }
}

/**
 * POST /staff
 */
async function inviteStaff(req, res, next) {
  try {
    const staffData = req.body
    const { doctor_id } = req.body
    if (doctor_id) staffData.doctor_id = doctor_id

    if (!staffData.name || !staffData.role || !staffData.email) {
      return errorResponse(res, 'Name, role, and email are required', 400)
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staffData.email)) {
      return errorResponse(res, 'Invalid email address', 400)
    }
    if (staffData.role === 'admin' && req.staff.role !== 'admin') {
      return errorResponse(res, 'Only admins can create admin accounts', 403)
    }
    if (req.body.password && req.body.password.length < 8) {
      return errorResponse(res, 'Password must be at least 8 characters', 400)
    }
    // A doctor invited without a doctor_id gets a new doctor record from StaffService.inviteStaff: the plan limit applies
    // (the same count and message as POST /clinic/doctors), before anything is inserted or any email is sent
    if (staffData.role === 'doctor' && !staffData.doctor_id) {
      const doctorLimit = doctorLimitFor(req.tenant?.plan)
      const activeDoctors = await pool.query('SELECT COUNT(*)::int AS n FROM clinic_doctors WHERE tenant_id = $1 AND is_active = true', [req.tenantId])
      if (activeDoctors.rows[0].n >= doctorLimit) {
        return errorResponse(res, `Your plan allows up to ${doctorLimit} doctor(s). Upgrade your plan to add more.`, 403)
      }
    }

    const password = req.body.password || generateTempPassword()
    const password_hash = await bcrypt.hash(password, 12)
    staffData.password_hash = password_hash
    
    const staff = await StaffService.inviteStaff(req.tenantId, staffData)
    await logAction({ tenantId: req.tenantId, staffId: req.staff?.id, action: 'staff.created', entityType: 'staff', entityId: staff?.id, ipAddress: req.ip });

    await sendWelcomeEmail({
      to: staff.email,
      name: staff.name,
      clinicName: req.tenant.name || 'Your Clinic',
      tempPassword: password
    })
    const { password_hash: _ph2, ...safeStaff2 } = staff;
    return successResponse(res, { staff: safeStaff2 }, 201)
  } catch (error) {
    next(error)
  }
}

// Why a staff member cannot be deactivated (the rules of DELETE /staff/:id): not yourself, and never the last active admin
// of the clinic. Returns a message, or null when the deactivation is allowed.
async function deactivationBlocker(req, target) {
  if (req.params.id === req.staff.id) return 'You cannot deactivate your own account'
  if (target?.role === 'admin') {
    const adminCount = await pool.query(
      'SELECT COUNT(*) FROM staff WHERE tenant_id = $1 AND role = $2 AND is_active = true',
      [req.tenantId, 'admin']
    )
    if (parseInt(adminCount.rows[0].count) <= 1) return 'Cannot deactivate the last admin account'
  }
  return null
}

/**
 * PATCH /staff/:id
 */
async function updateStaff(req, res, next) {
  try {
    const updates = req.body
    let staff;

    // The target must be a staff member of this clinic, and only an admin may change an admin account
    const target = await StaffModel.getStaffById(pool, req.tenantId, req.params.id)
    if (!target) {
      return errorResponse(res, 'Staff member not found', 404)
    }
    if (target.role === 'admin' && req.staff.role !== 'admin') {
      return errorResponse(res, 'Only an admin can change an admin account', 403)
    }
    if (updates.is_active !== undefined) {
      if (typeof updates.is_active !== 'boolean') {
        return errorResponse(res, 'is_active must be true or false', 400)
      }
      if (req.params.id === req.staff.id) {
        return errorResponse(res, 'You cannot change your own active status', 400)
      }
    }
    let emailChanged = false
    let activeChanged = false
    
    if (updates.role) {
      if (req.params.id === req.staff.id) {
        return errorResponse(res, 'You cannot change your own role', 400)
      }
      if (updates.role === 'admin' && req.staff.role !== 'admin') {
        return errorResponse(res, 'Only admins can grant the admin role', 403)
      }
      if (updates.role !== 'admin') {
        const targetStaff = await StaffModel.getStaffById(pool, req.tenantId, req.params.id)
        if (targetStaff?.role === 'admin') {
          const adminCount = await pool.query(
            'SELECT COUNT(*) FROM staff WHERE tenant_id = $1 AND role = $2 AND is_active = true',
            [req.tenantId, 'admin']
          )
          if (parseInt(adminCount.rows[0].count) <= 1) {
            return errorResponse(res, 'Cannot change role of the last admin account', 400)
          }
        }
      }
      staff = await StaffService.updateStaffRole(req.tenantId, req.params.id, updates.role)
    } else {
      const changes = { ...updates }
      // Email change: admin only, and never an address another staff member of this clinic already uses
      if (changes.email !== undefined) {
        const newEmail = typeof changes.email === 'string' ? changes.email.trim() : ''
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
          return errorResponse(res, 'Invalid email address', 400)
        }
        if (newEmail.toLowerCase() !== String(target.email || '').toLowerCase()) {
          if (req.staff.role !== 'admin') {
            return errorResponse(res, 'Only an admin can change a staff email', 403)
          }
          if (await StaffModel.isEmailInUse(pool, req.tenantId, newEmail, req.params.id)) {
            return errorResponse(res, 'A staff member with this email already exists', 409)
          }
          emailChanged = true
        }
        changes.email = newEmail
      }
      // Deactivating follows the rules of DELETE /staff/:id: the same blocker, and deleteStaff removes the person's sessions
      const deactivating = changes.is_active === false && target.is_active !== false
      if (deactivating) {
        const blocker = await deactivationBlocker(req, target)
        if (blocker) return errorResponse(res, blocker, 400)
        delete changes.is_active
        if (Object.keys(changes).length > 0) {
          await StaffModel.updateStaff(pool, req.tenantId, req.params.id, changes)
        }
        staff = await StaffModel.deleteStaff(pool, req.tenantId, req.params.id)
        activeChanged = true
      } else {
        staff = await StaffModel.updateStaff(pool, req.tenantId, req.params.id, changes)
        activeChanged = !!staff && changes.is_active === true && target.is_active === false
      }
    }

    if (!staff) {
      return errorResponse(res, 'Staff member not found', 404)
    }
    // Best-effort audit entries (logAction never throws); no email addresses are recorded
    if (emailChanged) {
      await logAction({ tenantId: req.tenantId, staffId: req.staff?.id, action: 'staff.email_changed', entityType: 'staff', entityId: req.params.id, ipAddress: req.ip })
    }
    if (activeChanged) {
      await logAction({ tenantId: req.tenantId, staffId: req.staff?.id, action: 'staff.active_changed', entityType: 'staff', entityId: req.params.id, metadata: { is_active: staff.is_active }, ipAddress: req.ip })
    }
    const { password_hash: _ph3, ...safeStaff3 } = staff;
    return successResponse(res, { staff: safeStaff3 })
  } catch (error) {
    next(error)
  }
}

/**
 * DELETE /staff/:id
 */
async function deleteStaff(req, res, next) {
  try {
    if (req.params.id === req.staff.id) {
      return errorResponse(res, 'You cannot deactivate your own account', 400)
    }

    const targetStaff = await StaffModel.getStaffById(pool, req.tenantId, req.params.id)
    if (targetStaff?.role === 'admin') {
      const adminCount = await pool.query(
        'SELECT COUNT(*) FROM staff WHERE tenant_id = $1 AND role = $2 AND is_active = true',
        [req.tenantId, 'admin']
      )
      if (parseInt(adminCount.rows[0].count) <= 1) {
        return errorResponse(res, 'Cannot deactivate the last admin account', 400)
      }
    }

    const staff = await StaffModel.deleteStaff(pool, req.tenantId, req.params.id)
    if (!staff) {
      return errorResponse(res, 'Staff member not found', 404)
    }
    await logAction({ tenantId: req.tenantId, staffId: req.staff?.id, action: 'staff.deleted', entityType: 'staff', entityId: req.params.id, ipAddress: req.ip });
    return successResponse(res, { message: 'Staff deactivated successfully' })
  } catch (error) {
    next(error)
  }
}

/**
 * PATCH /staff/:id/activate
 */
async function activateStaff(req, res, next) {
  try {
    const target = await StaffModel.getStaffById(pool, req.tenantId, req.params.id)
    if (!target) return errorResponse(res, 'Staff member not found', 404)
    if (target.role === 'admin' && req.staff.role !== 'admin') {
      return errorResponse(res, 'Only an admin can change an admin account', 403)
    }
    const staff = await StaffModel.updateStaff(pool, req.tenantId, req.params.id, { is_active: true })
    if (!staff) return errorResponse(res, 'Staff member not found', 404)
    if (target.is_active === false) {
      await logAction({ tenantId: req.tenantId, staffId: req.staff?.id, action: 'staff.active_changed', entityType: 'staff', entityId: req.params.id, metadata: { is_active: true }, ipAddress: req.ip })
    }
    const { password_hash: _ph4, ...safeStaff4 } = staff;
    return successResponse(res, { staff: safeStaff4 })
  } catch (error) {
    next(error)
  }
}

/**
 * DELETE /staff/:id/permanent
 */
async function deleteStaffPermanent(req, res, next) {
  try {
    if (req.params.id === req.staff.id) {
      return errorResponse(res, 'Cannot delete your own account', 400)
    }
    const target = await StaffModel.getStaffById(pool, req.tenantId, req.params.id)
    if (!target) return errorResponse(res, 'Staff not found', 404)
    if (target?.role === 'admin') {
      const adminCount = await pool.query(
        'SELECT COUNT(*) FROM staff WHERE tenant_id = $1 AND role = $2 AND is_active = true',
        [req.tenantId, 'admin']
      )
      if (parseInt(adminCount.rows[0].count) <= 1) {
        return errorResponse(res, 'Cannot delete the last admin account', 400)
      }
    }
    await pool.query('DELETE FROM auth_sessions WHERE staff_id = $1', [req.params.id])
    await pool.query('DELETE FROM staff WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId])
    return successResponse(res, { message: 'Staff member permanently deleted' })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getStaff,
  getStaffById,
  inviteStaff,
  updateStaff,
  deleteStaff,
  activateStaff,
  deleteStaffPermanent
}

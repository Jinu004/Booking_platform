const StaffService = require('./staff.service')
const StaffModel = require('./staff.model')
const pool = require('../../config/database')
const { successResponse, errorResponse } = require('../../utils/response')
const { bcrypt } = require('../../config/auth')
const { sendWelcomeEmail } = require('../../utils/email')

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

    const password = req.body.password || generateTempPassword()
    const password_hash = await bcrypt.hash(password, 12)
    staffData.password_hash = password_hash
    
    const staff = await StaffService.inviteStaff(req.tenantId, staffData)

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

/**
 * PATCH /staff/:id
 */
async function updateStaff(req, res, next) {
  try {
    const updates = req.body
    let staff;
    
    if (updates.role) {
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
      staff = await StaffModel.updateStaff(pool, req.tenantId, req.params.id, updates)
    }

    if (!staff) {
      return errorResponse(res, 'Staff member not found', 404)
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
    const staff = await StaffModel.updateStaff(pool, req.tenantId, req.params.id, { is_active: true })
    if (!staff) return errorResponse(res, 'Staff member not found', 404)
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

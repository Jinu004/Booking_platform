const StaffService = require('./staff.service')
const StaffModel = require('./staff.model')
const pool = require('../../config/database')
const { successResponse, errorResponse } = require('../../utils/response')
const { bcrypt } = require('../../config/auth')
const { sendWelcomeEmail } = require('../../utils/email')

function generateTempPassword() {
  return Math.random().toString(36).slice(-8) + 'A1!'
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
    return successResponse(res, { staff })
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
      clinicName: req.tenant.name || 'Your Clinic'
    })
    return successResponse(res, { staff }, 201)
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
      staff = await StaffService.updateStaffRole(req.tenantId, req.params.id, updates.role)
    } else {
      staff = await StaffModel.updateStaff(pool, req.tenantId, req.params.id, updates)
    }

    if (!staff) {
      return errorResponse(res, 'Staff member not found', 404)
    }
    return successResponse(res, { staff })
  } catch (error) {
    next(error)
  }
}

/**
 * DELETE /staff/:id
 */
async function deleteStaff(req, res, next) {
  try {
    const staff = await StaffModel.deleteStaff(pool, req.tenantId, req.params.id)
    if (!staff) {
      return errorResponse(res, 'Staff member not found', 404)
    }
    return successResponse(res, { message: 'Staff deactivated successfully' })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getStaff,
  getStaffById,
  inviteStaff,
  updateStaff,
  deleteStaff
}

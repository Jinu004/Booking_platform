const StaffService = require('./staff.service')
const StaffModel = require('./staff.model')
const pool = require('../../config/database')
const { successResponse, errorResponse } = require('../../utils/response')
const logger = require('../../utils/logger')

/**
 * GET /staff
 */
async function getStaff(req, res) {
  try {
    const staff = await StaffService.getStaffWithStats(req.tenantId)
    return successResponse(res, { staff })
  } catch (error) {
    logger.error('Failed to get staff:', error.message)
    return errorResponse(res, 'Failed to fetch staff', 500)
  }
}

/**
 * GET /staff/:id
 */
async function getStaffById(req, res) {
  try {
    const staff = await StaffModel.getStaffById(pool, req.tenantId, req.params.id)
    if (!staff) {
      return errorResponse(res, 'Staff member not found', 404)
    }
    return successResponse(res, { staff })
  } catch (error) {
    logger.error('Failed to get staff by ID:', error.message)
    return errorResponse(res, 'Failed to fetch staff member', 500)
  }
}

/**
 * POST /staff
 */
async function inviteStaff(req, res) {
  try {
    const staffData = req.body
    if (!staffData.name || !staffData.role || !staffData.email) {
      return errorResponse(res, 'Name, role, and email are required', 400)
    }
    
    const staff = await StaffService.inviteStaff(req.tenantId, staffData)
    return successResponse(res, { staff }, 201)
  } catch (error) {
    logger.error('Failed to invite staff:', error.message)
    return errorResponse(res, error.message || 'Failed to invite staff member', 500)
  }
}

/**
 * PATCH /staff/:id
 */
async function updateStaff(req, res) {
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
    logger.error('Failed to update staff:', error.message)
    return errorResponse(res, error.message || 'Failed to update staff member', 500)
  }
}

/**
 * DELETE /staff/:id
 */
async function deleteStaff(req, res) {
  try {
    const staff = await StaffModel.deleteStaff(pool, req.tenantId, req.params.id)
    if (!staff) {
      return errorResponse(res, 'Staff member not found', 404)
    }
    return successResponse(res, { message: 'Staff deactivated successfully' })
  } catch (error) {
    logger.error('Failed to delete staff:', error.message)
    return errorResponse(res, 'Failed to deactivate staff member', 500)
  }
}

module.exports = {
  getStaff,
  getStaffById,
  inviteStaff,
  updateStaff,
  deleteStaff
}

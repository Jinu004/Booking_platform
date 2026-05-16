const { successResponse, errorResponse } = require('../../utils/response')
const TenantService = require('../tenant/tenant.service')
const logger = require('../../utils/logger')

/**
 * GET /settings
 * Gets all tenant configuration settings and groups them
 */
async function getSettings(req, res) {
  try {
    const configs = await TenantService
      .getAllConfigs(req.tenantId)

    const settings = {
      general: {},
      booking: {},
      ai: {},
      notifications: {}
    }

    for (const [key, value] of Object.entries(configs)) {
      const k = key.toLowerCase()
      if (
        k.includes('ai_') ||
        k.includes('escalation') ||
        k.includes('language') ||
        k.includes('greeting')
      ) {
        settings.ai[key] = value
      } else if (
        k.includes('booking_') ||
        k.includes('token_') ||
        k.includes('weekly_off') ||
        k.includes('avg_consultation') ||
        k.includes('reset_time') ||
        k.includes('max_tokens')
      ) {
        settings.booking[key] = value
      } else if (
        k.includes('notification_') ||
        k.includes('reminder_')
      ) {
        settings.notifications[key] = value
      } else {
        settings.general[key] = value
      }
    }

    return successResponse(res, settings)
  } catch (err) {
    logger.error('Failed to get settings:', err.message)
    return errorResponse(res, 'Failed to fetch settings', 500)
  }
}

/**
 * PUT /settings
 * Updates multiple settings at once
 * Body: { "key1": "value1", "key2": "value2" }
 */
async function updateSettings(req, res) {
  try {
    const updates = req.body
    
    for (const [key, value] of Object.entries(updates)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        await TenantService.setConfig(req.tenantId, key, value.toString())
      }
    }

    // Return the updated settings back
    return getSettings(req, res)
  } catch (err) {
    logger.error('Failed to update settings:', err.message)
    return errorResponse(res, 'Failed to update settings', 500)
  }
}

/**
 * GET /settings/clinic
 * Gets clinic specific profile
 */
async function getClinicSettings(req, res) {
  try {
    const configs = await TenantService
      .getAllConfigs(req.tenantId)

    const clinicProfile = {}
    for (const [key, value] of Object.entries(configs)) {
      if (key.startsWith('clinic_')) {
        clinicProfile[key.replace('clinic_', '')] = value
      }
    }

    return successResponse(res, clinicProfile)
  } catch (err) {
    logger.error(
      'Failed to get clinic settings:', err.message
    )
    return errorResponse(
      res, 'Failed to fetch clinic settings', 500
    )
  }
}

/**
 * PUT /settings/clinic
 */
async function updateClinicSettings(req, res) {
  try {
    const updates = req.body
    
    for (const [key, value] of Object.entries(updates)) {
       await TenantService.setConfig(req.tenantId, `clinic_${key}`, String(value))
    }

    return getClinicSettings(req, res)
  } catch (err) {
    logger.error('Failed to update clinic settings:', err.message)
    return errorResponse(res, 'Failed to update clinic settings', 500)
  }
}

/**
 * GET /settings/hitl
 * Gets tenant_settings (working hours, handoff message, out of hours message)
 */
async function getHITLSettings(req, res) {
  const pool = require('../../config/database')
  try {
    const result = await pool.query(
      'SELECT * FROM tenant_settings WHERE tenant_id = $1',
      [req.tenantId]
    )
    if (!result.rows.length) {
      return errorResponse(res, 'HITL settings not found', 404)
    }
    return successResponse(res, result.rows[0])
  } catch (err) {
    logger.error('Failed to get HITL settings:', err.message)
    return errorResponse(res, 'Failed to fetch HITL settings', 500)
  }
}

/**
 * PUT /settings/hitl
 * Updates tenant_settings
 * Body: { working_hours, handoff_message, out_of_hours_message }
 */
async function updateHITLSettings(req, res) {
  const pool = require('../../config/database')
  try {
    const { working_hours, handoff_message, out_of_hours_message } = req.body
    const result = await pool.query(
      `UPDATE tenant_settings
       SET working_hours = COALESCE($1, working_hours),
           handoff_message = COALESCE($2, handoff_message),
           out_of_hours_message = COALESCE($3, out_of_hours_message),
           updated_at = NOW()
       WHERE tenant_id = $4
       RETURNING *`,
      [
        working_hours ? JSON.stringify(working_hours) : null,
        handoff_message || null,
        out_of_hours_message || null,
        req.tenantId
      ]
    )
    if (!result.rows.length) {
      return errorResponse(res, 'HITL settings not found', 404)
    }
    return successResponse(res, result.rows[0])
  } catch (err) {
    logger.error('Failed to update HITL settings:', err.message)
    return errorResponse(res, 'Failed to update HITL settings', 500)
  }
}

module.exports = {
  getSettings,
  updateSettings,
  getClinicSettings,
  updateClinicSettings,
  getHITLSettings,
  updateHITLSettings
}

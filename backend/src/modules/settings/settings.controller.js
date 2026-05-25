const { successResponse, errorResponse } = require('../../utils/response')
const TenantService = require('../tenant/tenant.service')
const logger = require('../../utils/logger')
const pool = require('../../config/database')

/**
 * Permitted keys for PUT /settings.
 * Prevents injection of arbitrary config keys (e.g. jwt_secret, admin_override)
 * that could be read by AI prompts or other system components.
 */
const ALLOWED_SETTINGS_KEYS = new Set([
  // AI / conversation
  'language',
  'ai_personality', 'ai_language', 'ai_greeting', 'ai_name', 'ai_tone',
  'ai_escalation_message', 'ai_response_delay',
  'escalation_threshold', 'escalation_timeout',
  // Booking / token
  'booking_advance_days', 'booking_confirmation_msg', 'booking_cancel_msg',
  'booking_same_day', 'token_prefix', 'token_format',
  'weekly_off', 'avg_consultation_minutes', 'reset_time', 'max_tokens_per_day',
  'opening_time', 'closing_time',
  // Notifications
  'notification_reminder_hours', 'reminder_enabled', 'notification_channel',
])

/**
 * GET /settings
 * Gets all tenant configuration settings and groups them
 */
async function getSettings(req, res, next) {
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
    next(err)
  }
}

/**
 * PUT /settings
 * Updates multiple settings at once
 * Body: { "key1": "value1", "key2": "value2" }
 */
async function updateSettings(req, res, next) {
  try {
    const updates = req.body

    const rejectedKeys = Object.keys(updates).filter(k => !ALLOWED_SETTINGS_KEYS.has(k))
    if (rejectedKeys.length > 0) {
      return errorResponse(res, `Invalid settings keys: ${rejectedKeys.join(', ')}`, 400)
    }

    for (const [key, value] of Object.entries(updates)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        await TenantService.setConfig(req.tenantId, key, value.toString())
      }
    }

    // Return the updated settings back
    return getSettings(req, res, next)
  } catch (err) {
    next(err)
  }
}

/**
 * GET /settings/clinic
 * Gets clinic specific profile
 */
async function getClinicSettings(req, res, next) {
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
    next(err)
  }
}

/**
 * PUT /settings/clinic
 */
async function updateClinicSettings(req, res, next) {
  try {
    const updates = req.body
    
    for (const [key, value] of Object.entries(updates)) {
       await TenantService.setConfig(req.tenantId, `clinic_${key}`, String(value))
    }

    return getClinicSettings(req, res, next)
  } catch (err) {
    next(err)
  }
}

/**
 * GET /settings/hitl
 * Gets tenant_settings (working hours, handoff message, out of hours message)
 */
async function getHITLSettings(req, res, next) {
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
    next(err)
  }
}

/**
 * PUT /settings/hitl
 * Updates tenant_settings
 * Body: { working_hours, handoff_message, out_of_hours_message }
 */
async function updateHITLSettings(req, res, next) {
  try {
    const { working_hours, handoff_message, out_of_hours_message, ai_knowledge_base } = req.body
    const result = await pool.query(
      `UPDATE tenant_settings
       SET working_hours = COALESCE($1, working_hours),
           handoff_message = COALESCE($2, handoff_message),
           out_of_hours_message = COALESCE($3, out_of_hours_message),
           ai_knowledge_base = COALESCE($5, ai_knowledge_base),
           updated_at = NOW()
       WHERE tenant_id = $4
       RETURNING *`,
      [
        working_hours ? JSON.stringify(working_hours) : null,
        handoff_message || null,
        out_of_hours_message || null,
        req.tenantId,
        ai_knowledge_base !== undefined ? ai_knowledge_base : null
      ]
    )
    if (!result.rows.length) {
      return errorResponse(res, 'HITL settings not found', 404)
    }
    return successResponse(res, result.rows[0])
  } catch (err) {
    next(err)
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

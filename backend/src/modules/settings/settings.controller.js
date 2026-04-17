const { successResponse, errorResponse } = require('../../utils/response')
const TenantService = require('../tenant/tenant.service')
const logger = require('../../utils/logger')

/**
 * GET /settings
 * Gets all tenant configuration settings and groups them
 */
async function getSettings(req, res) {
  try {
    const rawConfigs = await TenantService.getAllConfigs(req.tenantId)
    
    // Group configurations safely assuming simple key naming conventions
    // Normally these categories could be handled by a config schema definition
    const settings = {
      general: {},
      booking: {},
      ai: {},
      notifications: {}
    }

    rawConfigs.forEach(conf => {
      const key = conf.config_key.toLowerCase()
      if (key.includes('ai_') || key.includes('escalation')) {
        settings.ai[conf.config_key] = conf.config_value
      } else if (key.includes('booking_') || key.includes('token_') || key.includes('off_')) {
        settings.booking[conf.config_key] = conf.config_value
      } else if (key.includes('notification_') || key.includes('reminder_')) {
        settings.notifications[conf.config_key] = conf.config_value
      } else {
        settings.general[conf.config_key] = conf.config_value
      }
    })

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
    // In our system, clinic settings are either in `tenants` table or config.
    // For now, let's treat config keys starting with clinic_ as clinic settings
    const rawConfigs = await TenantService.getAllConfigs(req.tenantId)
    const clinicProfile = {}
    
    rawConfigs.forEach(c => {
      if (c.config_key.startsWith('clinic_')) {
        clinicProfile[c.config_key.replace('clinic_', '')] = c.config_value
      }
    })

    return successResponse(res, clinicProfile)
  } catch (err) {
    logger.error('Failed to get clinic settings:', err.message)
    return errorResponse(res, 'Failed to fetch clinic settings', 500)
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

module.exports = {
  getSettings,
  updateSettings,
  getClinicSettings,
  updateClinicSettings
}

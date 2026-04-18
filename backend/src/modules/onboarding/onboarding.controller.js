const pool = require('../../config/database');
const TenantService = require('../tenant/tenant.service');
const tenantModel = require('../tenant/tenant.model');
const { successResponse, errorResponse } = require('../../utils/response');
const logger = require('../../utils/logger');

/**
 * POST /onboarding/clinic
 * Creates a new clinic tenant
 */
async function onboardClinic(req, res) {
  try {
    const {
      clinicName, ownerName, email, phone,
      whatsappNumber, plan,
      openingTime, closingTime, weeklyOff,
      avgConsultationMinutes,
      maxTokens
    } = req.body;

    if (!clinicName || !ownerName || !email || !whatsappNumber) {
      return errorResponse(res, 'Missing required fields', 400);
    }

    // 1 & 3: Creates tenant and sets default configs
    const tenant = await TenantService.createTenant({
      name: clinicName,
      industry: 'clinic',
      whatsappNumber,
      plan: plan || 'starter'
    });

    // 2. Create clinic profile
    await pool.query(
      `INSERT INTO clinic_profiles (tenant_id, opening_time, closing_time, weekly_off) VALUES ($1, $2, $3, $4)`,
      [tenant.id, openingTime || '09:00', closingTime || '18:00', weeklyOff || 'sunday']
    );

    // Overwrite configs if provided
    if (avgConsultationMinutes) {
      await TenantService.setConfig(tenant.id, 'avg_consultation_minutes', String(avgConsultationMinutes));
    }
    if (maxTokens) {
      await TenantService.setConfig(tenant.id, 'max_tokens_per_day', String(maxTokens));
    }

    // Optional: add the owner to the staff table for auth bypass to work correctly
    // or just assume standard flow handles it. We'll add staff entry here to be safe and complete.
    await pool.query(
      `INSERT INTO staff (tenant_id, name, email, phone, role) VALUES ($1, $2, $3, $4, 'admin')`,
      [tenant.id, ownerName, email, phone]
    );

    return successResponse(res, {
      tenant_id: tenant.id,
      name: tenant.name,
      whatsapp_number: tenant.whatsapp_number,
      instructions: "Please scan the QR code via setting page to activate WAHA."
    });
  } catch (err) {
    logger.error('Error during clinic onboarding:', err.message);
    if (err.message.includes('already registered')) {
      return errorResponse(res, err.message, 400);
    }
    return errorResponse(res, 'Failed to onboard clinic', 500);
  }
}

/**
 * GET /onboarding/check-whatsapp/:number
 * Checks if WhatsApp number is already registered
 */
async function checkWhatsappAvailable(req, res) {
  try {
    const { number } = req.params;
    const exists = await tenantModel.whatsappNumberExists(pool, number);
    
    // We normalize inside tenant.service technically, but tenantModel might just check exact.
    // TenantService uses normalizeNumber let's assume it checks +91... format. 
    // To be safe we try checking normalized.
    let cleaned = number.replace(/[^\\d+]/g, '');
    if (!cleaned.startsWith('+')) {
      if (cleaned.startsWith('91')) cleaned = '+' + cleaned;
      else if (cleaned.length === 10) cleaned = '+91' + cleaned;
    }

    const actuallyExists = await tenantModel.whatsappNumberExists(pool, cleaned);
    return successResponse(res, { available: !actuallyExists });
  } catch (err) {
    logger.error('Error checking whatsapp available:', err.message);
    return errorResponse(res, 'Failed to check availability', 500);
  }
}

/**
 * GET /onboarding/plans
 * Returns available plans and pricing
 */
async function getPlans(req, res) {
  return successResponse(res, {
    starter: {
      name: 'Starter',
      price: 2999,
      features: [
        'Up to 50 tokens per day',
        'AI WhatsApp responses',
        '1 doctor',
        'Basic analytics',
        'Email support'
      ]
    },
    growth: {
      name: 'Growth',
      price: 5999,
      features: [
        'Up to 150 tokens per day',
        'AI WhatsApp responses',
        'Up to 5 doctors',
        'Advanced analytics',
        'Priority support',
        'Custom AI responses'
      ]
    },
    pro: {
      name: 'Pro',
      price: 9999,
      features: [
        'Unlimited tokens',
        'AI WhatsApp responses',
        'Unlimited doctors',
        'Full analytics',
        '24/7 support',
        'Custom branding',
        'API access'
      ]
    }
  });
}

module.exports = {
  onboardClinic,
  checkWhatsappAvailable,
  getPlans
};

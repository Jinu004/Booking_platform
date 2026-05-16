const pool = require('../../config/database');
const TenantService = require('../tenant/tenant.service');
const tenantModel = require('../tenant/tenant.model');
const { successResponse, errorResponse } = require('../../utils/response');
const logger = require('../../utils/logger');
const bcrypt = require('bcryptjs');
const { generateToken } = require('../../config/auth');

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
      maxTokens,
      password
    } = req.body;

    if (!clinicName || !ownerName || !email || !whatsappNumber) {
      return errorResponse(res, 'Missing required fields', 400);
    }
    
    if (!password || password.length < 8) {
      return errorResponse(res, 'Password must be at least 8 characters', 400);
    }

    const password_hash = await bcrypt.hash(password, 12);

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

    await pool.query(
      `INSERT INTO staff 
       (tenant_id, name, email, phone, role, is_active, password_hash, email_verified) 
       VALUES ($1, $2, $3, $4, 'admin', true, $5, true)`,
      [tenant.id, ownerName, email, phone, password_hash]
    );


const staffResult = await pool.query(
      `SELECT s.*, t.name AS tenant_name, t.plan AS tenant_plan, t.status AS tenant_status, t.whatsapp_number AS whatsapp_number
       FROM staff s
       JOIN tenants t ON t.id = s.tenant_id
       WHERE s.email = $1`,
      [email]
    );
    const newStaff = staffResult.rows[0];

    const token = generateToken({
      staffId: newStaff.id,
      tenantId: newStaff.tenant_id,
      role: newStaff.role,
      email: newStaff.email,
      name: newStaff.name
    });

    // Store session
    await pool.query(
      `INSERT INTO auth_sessions
       (id, staff_id, tenant_id, token, expires_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW() + INTERVAL '7 days')`,
      [newStaff.id, newStaff.tenant_id, token]
    );

    return successResponse(res, {
      token,
staff: {
        id: newStaff.id,
        name: newStaff.name,
        email: newStaff.email,
        role: newStaff.role,
        tenantId: newStaff.tenant_id,
        tenantName: newStaff.tenant_name,
        tenantPlan: newStaff.tenant_plan,
        tenantStatus: newStaff.tenant_status,
        tenantWhatsapp: newStaff.whatsapp_number
      },
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
    let cleaned = number.replace(/[^\d+]/g, '');
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

const pool = require('../../config/database');
const TenantService = require('../tenant/tenant.service');
const tenantModel = require('../tenant/tenant.model');
const { successResponse, errorResponse } = require('../../utils/response');
const logger = require('../../utils/logger');
const bcrypt = require('bcryptjs');
const { generateToken } = require('../../config/auth');

/**
 * POST /onboarding/clinic
 * Creates a new clinic tenant.
 * All DB writes (tenant, clinic_profile, configs, staff, session) are
 * wrapped in a single transaction — if staff creation fails (e.g. duplicate
 * email) the tenant record is rolled back, leaving no orphaned data.
 */
async function onboardClinic(req, res) {
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Normalize WhatsApp number (mirrors TenantService.normalizeNumber)
    let normalizedWA = whatsappNumber.replace(/[^\d+]/g, '');
    if (!normalizedWA.startsWith('+')) {
      if (normalizedWA.startsWith('91')) normalizedWA = '+' + normalizedWA;
      else if (normalizedWA.length === 10) normalizedWA = '+91' + normalizedWA;
    }

    // Duplicate WhatsApp check inside the transaction
    const waCheck = await client.query(
      'SELECT id FROM tenants WHERE whatsapp_number = $1',
      [normalizedWA]
    );
    if (waCheck.rows.length) throw new Error('WhatsApp number is already registered');

    // Generate unique slug inside the transaction
    let baseSlug = clinicName.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, '-');
    let slug = baseSlug;
    const slugCheck = await client.query('SELECT id FROM tenants WHERE slug = $1', [slug]);
    if (slugCheck.rows.length) {
      slug = `${baseSlug}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    // 1. Create tenant
    const tenantRes = await client.query(
      `INSERT INTO tenants (name, slug, industry, plan, whatsapp_number, status)
       VALUES ($1, $2, 'clinic', $3, $4, 'pending') RETURNING *`,
      [clinicName, slug, plan || 'starter', normalizedWA]
    );
    const tenant = tenantRes.rows[0];

    // 2. Create clinic profile
    await client.query(
      `INSERT INTO clinic_profiles (tenant_id, opening_time, closing_time, weekly_off)
       VALUES ($1, $2, $3, $4)`,
      [tenant.id, openingTime || '09:00', closingTime || '18:00', weeklyOff || 'sunday']
    );

    // 3. Set default + custom configs for clinic industry
    const defaultConfigs = {
      avg_consultation_minutes: String(avgConsultationMinutes || '10'),
      max_tokens_per_day: String(maxTokens || '50'),
      reset_time: '06:00',
      language: 'english',
      weekly_off: weeklyOff || 'sunday',
      booking_mode: 'token',
      reminder_24h: 'true',
      reminder_2h: 'false'
    };
    for (const [key, value] of Object.entries(defaultConfigs)) {
      await client.query(
        `INSERT INTO tenant_configs (tenant_id, key, value) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, key) DO UPDATE SET value = $3`,
        [tenant.id, key, value]
      );
    }

    // 4. Create admin staff member
    await client.query(
      `INSERT INTO staff
         (tenant_id, name, email, phone, role, is_active, password_hash, email_verified)
       VALUES ($1, $2, $3, $4, 'admin', true, $5, true)`,
      [tenant.id, ownerName, email, phone, password_hash]
    );

    // 5. Fetch the newly created staff (within the same transaction)
    const staffResult = await client.query(
      `SELECT s.*, t.name AS tenant_name, t.plan AS tenant_plan,
              t.status AS tenant_status, t.whatsapp_number AS whatsapp_number
       FROM staff s
       JOIN tenants t ON t.id = s.tenant_id
       WHERE s.email = $1 AND s.tenant_id = $2`,
      [email, tenant.id]
    );
    const newStaff = staffResult.rows[0];

    const token = generateToken({
      staffId: newStaff.id,
      tenantId: newStaff.tenant_id,
      role: newStaff.role,
      email: newStaff.email,
      name: newStaff.name
    });

    // 6. Store session
    await client.query(
      `INSERT INTO auth_sessions (id, staff_id, tenant_id, token, expires_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW() + INTERVAL '7 days')`,
      [newStaff.id, newStaff.tenant_id, token]
    );

    await client.query('COMMIT');

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
        tenantWhatsapp: newStaff.whatsapp_number,
        doctor_id: newStaff.doctor_id || null
      },
      tenant_id: tenant.id,
      name: tenant.name,
      whatsapp_number: tenant.whatsapp_number,
      instructions: "Please scan the QR code via setting page to activate WAHA."
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Error during clinic onboarding:', err.message || err.code || String(err));
    if (err.message.includes('already registered')) {
      return errorResponse(res, err.message, 400);
    }
    if (err.message.includes('duplicate key') && err.message.includes('staff')) {
      return errorResponse(res, 'Email address is already in use', 400);
    }
    return errorResponse(res, 'Failed to onboard clinic', 500);
  } finally {
    client.release();
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

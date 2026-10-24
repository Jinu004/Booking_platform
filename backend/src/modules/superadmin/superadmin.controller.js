const pool = require('../../config/database');
const { successResponse, errorResponse } = require('../../utils/response');
const logger = require('../../utils/logger');
const { bcrypt } = require('../../config/auth');
const {
  normalizeNumber,
  isPlaceholderWhatsappNumber,
  isManagedNumberChange,
  WHATSAPP_NUMBER_MANAGED_MESSAGE,
  WHATSAPP_NUMBER_IN_USE_MESSAGE
} = require('../tenant/tenant.service');
const { omitTenantSecrets } = require('../../utils/secretBox');
const { fetchWabaInfo } = require('../waba/waba.info.service');
const tenantModel = require('../tenant/tenant.model');
const { logAction } = require('../../utils/audit');

// The clinic's booking mode and its AI appointment switch, read from the two tenant_configs rows (additive fields on the tenant screens)
function withBookingModeFields(row) {
  const { booking_mode_raw: modeRaw, ai_appointment_booking_raw: aiRaw, ...rest } = row;
  return { ...rest, booking_mode: modeRaw === 'appointment' ? 'appointment' : 'token', ai_appointment_booking: aiRaw === 'true' };
}
const { TemplateError } = require('../waba/waba.templates.service');

// Connection flags for the tenant screens (the phone number id itself is not added to the response)
function withWhatsappFlags(row) {
  return {
    ...row,
    whatsapp_connected: !!row.whatsapp_phone_number_id,
    whatsapp_number_placeholder: isPlaceholderWhatsappNumber(row.whatsapp_number)
  };
}

/**
 * GET /superadmin/tenants
 * Lists all tenants with usage stats
 */
async function getAllTenants(req, res) {
  try {
    const sql = `
      SELECT t.id, t.name, t.plan, t.status, t.industry, t.whatsapp_number, t.whatsapp_phone_number_id, t.created_at, t.ai_model,
             t.whatsapp_waba_id, t.whatsapp_connected_at, (t.whatsapp_access_token_enc IS NOT NULL) AS whatsapp_token_set,
             (SELECT COUNT(*) FROM bookings b WHERE b.tenant_id = t.id AND b.created_at >= DATE_TRUNC('month', NOW())) AS booking_count,
             (SELECT COUNT(*) FROM conversations c WHERE c.tenant_id = t.id AND c.started_at >= DATE_TRUNC('month', NOW())) AS conversation_count,
             (SELECT COUNT(*) FROM customers cu WHERE cu.tenant_id = t.id) AS customer_count,
             (SELECT value FROM tenant_configs tc WHERE tc.tenant_id = t.id AND tc.key = 'proactive_templates_enabled') AS proactive_templates_enabled,
             (SELECT value FROM tenant_configs tc WHERE tc.tenant_id = t.id AND tc.key = 'recall_enabled') AS recall_enabled,
             (SELECT value FROM tenant_configs tc WHERE tc.tenant_id = t.id AND tc.key = 'booking_mode') AS booking_mode_raw,
             (SELECT value FROM tenant_configs tc WHERE tc.tenant_id = t.id AND tc.key = 'ai_appointment_booking') AS ai_appointment_booking_raw,
             (SELECT email FROM staff s WHERE s.tenant_id = t.id AND s.role = 'admin' LIMIT 1) AS email
      FROM tenants t
      ORDER BY t.created_at DESC
    `;
    const result = await pool.query(sql);
    return successResponse(res, result.rows.map((row) => withBookingModeFields(withWhatsappFlags(row))));
  } catch (err) {
    logger.error('Error fetching all tenants:', err.message);
    return errorResponse(res, 'Failed to fetch tenants', 500);
  }
}

/**
 * GET /superadmin/tenants/:id
 * Gets single tenant full details
 */
async function getTenantDetails(req, res) {
  try {
    const { id } = req.params;
    const sql = `SELECT * FROM tenants WHERE id = $1`;
    const result = await pool.query(sql, [id]);

    if (result.rows.length === 0) {
      return errorResponse(res, 'Tenant not found', 404);
    }

    const modeRows = await pool.query(
      `SELECT key, value FROM tenant_configs WHERE tenant_id = $1 AND key IN ('booking_mode', 'ai_appointment_booking')`,
      [id]
    );
    const modeConfig = Object.fromEntries(modeRows.rows.map((r) => [r.key, r.value]));
    return successResponse(res, withBookingModeFields({
      ...withWhatsappFlags(omitTenantSecrets(result.rows[0])),
      booking_mode_raw: modeConfig.booking_mode,
      ai_appointment_booking_raw: modeConfig.ai_appointment_booking
    }));
  } catch (err) {
    logger.error('Error fetching tenant details:', err.message);
    return errorResponse(res, 'Failed to fetch tenant', 500);
  }
}

/**
 * PATCH /superadmin/tenants/:id/status
 * Activates or suspends a tenant
 * Body: { status: 'active' | 'suspended' }
 */
async function updateTenantStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'suspended', 'pending'].includes(status)) {
      return errorResponse(res, 'Invalid status', 400);
    }

    const sql = `UPDATE tenants SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`;
    const result = await pool.query(sql, [status, id]);

    if (result.rows.length === 0) {
      return errorResponse(res, 'Tenant not found', 404);
    }

    // The sender's cached token and platform-token flag of this clinic are dropped too
    require('../channel/whatsapp/senderContext').clearTenantTokenCache(id);

    // The webhook caches the tenant by number for 5 minutes: drop it so the new status takes effect at once
    try {
      const redisClient = require('../../config/redis');
      const statusWhatsapp = result.rows[0].whatsapp_number;
      if (statusWhatsapp) await redisClient.del(`tenant_wa:${normalizeNumber(statusWhatsapp)}`);
    } catch (_) {}

    return successResponse(res, omitTenantSecrets(result.rows[0]));
  } catch (err) {
    logger.error('Error updating tenant status:', err.message);
    return errorResponse(res, 'Failed to update tenant status', 500);
  }
}

/**
 * GET /superadmin/stats
 * Platform wide statistics
 */
async function getPlatformStats(req, res) {
  try {
    // Basic general stats
    const tenantStats = await pool.query(`
      SELECT
        COUNT(*) as total_tenants,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_tenants
      FROM tenants
    `);

    const activityStats = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM bookings WHERE DATE(created_at) = CURRENT_DATE) as total_bookings_today,
        (SELECT COUNT(*) FROM conversations WHERE DATE(started_at) = CURRENT_DATE) as total_conversations_today
    `);

    // Basic revenue logic counting based on active plan counts just as an approximation
    const revenueStats = await pool.query(`
      SELECT SUM(
        CASE plan
          WHEN 'starter' THEN 2999
          WHEN 'growth' THEN 5999
          WHEN 'pro' THEN 9999
          ELSE 0
        END
      ) as total_revenue_this_month
      FROM tenants WHERE status = 'active'
    `);

    const stats = {
      total_tenants: parseInt(tenantStats.rows[0].total_tenants, 10) || 0,
      active_tenants: parseInt(tenantStats.rows[0].active_tenants, 10) || 0,
      total_bookings_today: parseInt(activityStats.rows[0].total_bookings_today, 10) || 0,
      total_conversations_today: parseInt(activityStats.rows[0].total_conversations_today, 10) || 0,
      total_revenue_this_month: parseInt(revenueStats.rows[0].total_revenue_this_month, 10) || 0
    };

    return successResponse(res, stats);
  } catch (err) {
    logger.error('Error fetching platform stats:', err.message);
    return errorResponse(res, 'Failed to fetch platform stats', 500);
  }
}

/**
 * POST /superadmin/tenants
 * Creates a new tenant and their admin staff account
 * Body: { clinicName, email, password, plan }
 */
async function createTenant(req, res) {
  const client = await pool.connect();
  try {
    const { clinicName, email, password, plan, industry } = req.body;

    if (!clinicName || !email || !password || !plan) {
      return errorResponse(res, 'All fields required', 400);
    }

    if (!['starter', 'growth', 'pro'].includes(plan)) {
      return errorResponse(res, 'Invalid plan', 400);
    }

    if (industry && !['clinic', 'enquiry'].includes(industry)) {
      return errorResponse(res, 'Invalid industry', 400);
    }

    const password_hash = await bcrypt.hash(password, 12);

    await client.query('BEGIN');

    const baseSlug = clinicName.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, '-');
    let slug = baseSlug;
    let slugExists = await client.query('SELECT id FROM tenants WHERE slug = $1', [slug]);
    while (slugExists.rows.length > 0) {
      const random4 = Math.floor(1000 + Math.random() * 9000);
      slug = `${baseSlug}-${random4}`;
      slugExists = await client.query('SELECT id FROM tenants WHERE slug = $1', [slug]);
    }
    const tenantResult = await client.query(
      `INSERT INTO tenants (id, name, slug, plan, status, industry, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'pending', $4, NOW(), NOW())
       RETURNING *`,
      [clinicName, slug, plan, industry || 'clinic']
    );

    const tenant = tenantResult.rows[0];

    await client.query(
      `INSERT INTO staff (id, tenant_id, name, email, password_hash, role, is_active, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'admin', true, NOW())`,
      [tenant.id, clinicName, email, password_hash]
    );

    await client.query('COMMIT');
    return successResponse(res, omitTenantSecrets(tenant), 201);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return errorResponse(res, 'Email already exists', 409);
    }
    logger.error('Error creating tenant:', err.message, err.stack, err.code, err.detail);
    return errorResponse(res, err.message || 'Failed to create tenant', 500);
  } finally {
    client.release();
  }
}

/**
 * PATCH /superadmin/tenants/:id
 * Edit tenant name, plan, whatsapp_number
 * Body: { clinicName, plan, whatsappNumber }
 */
async function updateTenant(req, res) {
  try {
    const { id } = req.params;
    const { clinicName, plan, whatsappNumber, industry, aiModel, email, whatsappPhoneNumberId } = req.body;
    const VALID_AI_MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']
    if (aiModel && !VALID_AI_MODELS.includes(aiModel)) {
      return errorResponse(res, 'Invalid AI model. Must be one of: ' + VALID_AI_MODELS.join(', '), 400)
    }

    const hasPhoneNumberId = whatsappPhoneNumberId !== undefined && whatsappPhoneNumberId !== null;
    const phoneNumberIdValue = hasPhoneNumberId ? String(whatsappPhoneNumberId).trim() : '';
    if (phoneNumberIdValue && !/^\d{8,20}$/.test(phoneNumberIdValue)) {
      return errorResponse(res, 'Invalid Phone Number ID. Must be 8-20 digits', 400);
    }

    let normalizedWhatsapp = whatsappNumber ? normalizeNumber(String(whatsappNumber)) : null;

    const existing = await pool.query('SELECT whatsapp_number, whatsapp_phone_number_id FROM tenants WHERE id = $1', [id]);
    const oldWhatsapp = existing.rows[0]?.whatsapp_number || null;

    // A tenant connected to Meta keeps the number Meta shows: a different value is refused, the same value is ignored
    if (normalizedWhatsapp && existing.rows[0]?.whatsapp_phone_number_id) {
      if (isManagedNumberChange(existing.rows[0], normalizedWhatsapp)) {
        return errorResponse(res, WHATSAPP_NUMBER_MANAGED_MESSAGE, 409);
      }
      normalizedWhatsapp = null;
    }

    const result = await pool.query(
      `UPDATE tenants
       SET name = COALESCE($1, name),
           plan = COALESCE($2, plan),
           whatsapp_number = COALESCE($3, whatsapp_number),
           industry = COALESCE($4, industry),
           ai_model = COALESCE($6, ai_model),
           whatsapp_phone_number_id = CASE WHEN $7::boolean THEN $8 ELSE whatsapp_phone_number_id END,
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [clinicName || null, plan || null, normalizedWhatsapp, industry || null, id, aiModel || null, hasPhoneNumberId, phoneNumberIdValue || null]
    );

    if (result.rows.length === 0) {
      return errorResponse(res, 'Tenant not found', 404);
    }

    try {
      const redisClient = require('../../config/redis');
      const newWhatsapp = result.rows[0].whatsapp_number;
      if (oldWhatsapp) await redisClient.del(`tenant_wa:${normalizeNumber(oldWhatsapp)}`);
      if (newWhatsapp) await redisClient.del(`tenant_wa:${normalizeNumber(newWhatsapp)}`);
    } catch (_) {}
    if (email) {
      await pool.query(
        `UPDATE staff SET email = $1 WHERE tenant_id = $2 AND role = 'admin'`,
        [email, id]
      );
    }

    try {
      const { broadcastToTenant } = require('../hitl/hitl.service');
      broadcastToTenant(id, 'session_refresh', { reason: 'plan_changed' });
    } catch (_) {}
    try {
      const redisClient = require('../../config/redis');
      await redisClient.del(`tenant_configs:${id}`);
    } catch (_) {}

    return successResponse(res, omitTenantSecrets(result.rows[0]));
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'idx_tenants_whatsapp_phone_number_id') {
      return errorResponse(res, 'This Phone Number ID is already assigned to another clinic', 409);
    }
    if (err.code === '23505' && err.constraint === 'tenants_whatsapp_number_key') {
      return errorResponse(res, WHATSAPP_NUMBER_IN_USE_MESSAGE, 409);
    }
    logger.error('Error updating tenant:', err.message);
    return errorResponse(res, 'Failed to update tenant', 500);
  }
}

/**
 * POST /superadmin/tenants/:id/booking-mode
 * Body: { mode: 'token' | 'appointment' }
 * Sets booking_mode and ai_appointment_booking together, in one transaction: 'appointment' turns both on, 'token' turns the AI switch off.
 */
async function setBookingMode(req, res) {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
      return errorResponse(res, 'Invalid tenant id', 400);
    }
    const exists = await pool.query('SELECT 1 FROM tenants WHERE id = $1', [id]);
    if (exists.rows.length === 0) {
      return errorResponse(res, 'Tenant not found', 404);
    }
    const mode = req.body && req.body.mode;
    if (mode !== 'token' && mode !== 'appointment') {
      return errorResponse(res, "mode must be 'token' or 'appointment'", 400);
    }

    const aiValue = mode === 'appointment' ? 'true' : 'false';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await tenantModel.setTenantConfig(client, id, 'booking_mode', mode);
      await tenantModel.setTenantConfig(client, id, 'ai_appointment_booking', aiValue);
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // The configs are cached for 60 seconds: drop the copy so both values apply at once
    try {
      await require('../../config/redis').del(`tenant_configs:${id}`);
    } catch (cacheErr) {
      logger.warn('Config cache clear failed after booking mode change:', cacheErr.message);
    }

    await logAction({
      tenantId: id,
      staffId: req.staff?.id,
      action: 'booking_mode_changed',
      entityType: 'tenant',
      entityId: id,
      metadata: { mode },
      ipAddress: req.ip
    });
    return successResponse(res, { mode, ai_appointment_booking: mode === 'appointment' });
  } catch (err) {
    logger.error('Error changing booking mode:', err.message);
    return errorResponse(res, 'Failed to change the booking mode', 500);
  }
}

/**
 * POST /superadmin/tenants/:id/sync-whatsapp-number
 * Copies the display number that Meta shows for the clinic's phone number id into tenants.whatsapp_number
 */
async function syncWhatsappNumber(req, res) {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
      return errorResponse(res, 'Invalid tenant id', 400);
    }
    const tenantRes = await pool.query('SELECT whatsapp_number, whatsapp_phone_number_id FROM tenants WHERE id = $1', [id]);
    if (tenantRes.rows.length === 0) {
      return errorResponse(res, 'Tenant not found', 404);
    }
    const row = tenantRes.rows[0];
    if (!row.whatsapp_phone_number_id) {
      return errorResponse(res, 'This clinic has no phone number id saved. Connect the number first.', 400);
    }

    let info;
    try {
      info = await fetchWabaInfo(id);
    } catch (err) {
      if (err instanceof TemplateError) return errorResponse(res, err.message, err.status);
      throw err;
    }
    const display = info?.phone?.display_phone_number;
    if (!display || !display.ok || !display.value) {
      return errorResponse(res, 'Could not read the display number from Meta', 502);
    }

    const normalized = normalizeNumber(String(display.value));
    const stored = row.whatsapp_number ? normalizeNumber(String(row.whatsapp_number)) : '';
    if (normalized === stored) {
      return successResponse(res, { changed: false, whatsapp_number: row.whatsapp_number });
    }

    await pool.query('UPDATE tenants SET whatsapp_number = $1, updated_at = NOW() WHERE id = $2', [normalized, id]);

    try {
      const redisClient = require('../../config/redis');
      if (stored) await redisClient.del(`tenant_wa:${stored}`);
      await redisClient.del(`tenant_wa:${normalized}`);
    } catch (_) {}

    logger.info(`WHATSAPP_NUMBER_SYNCED tenant=${id} number=****${normalized.slice(-4)}`);
    return successResponse(res, { changed: true, whatsapp_number: normalized });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'tenants_whatsapp_number_key') {
      return errorResponse(res, WHATSAPP_NUMBER_IN_USE_MESSAGE, 409);
    }
    logger.error('Error syncing WhatsApp number:', err.message);
    return errorResponse(res, 'Failed to sync the WhatsApp number', 500);
  }
}

/**
 * DELETE /superadmin/tenants/:id/conversations
 * Clears resolved/inactive conversations older than 30 days for a tenant
 */
async function deleteTenant(req, res) {
  try {
    const { id } = req.params;
    const tenant = await pool.query('SELECT * FROM tenants WHERE id = $1', [id]);
    if (!tenant.rows.length) return errorResponse(res, 'Clinic not found', 404);
    if (tenant.rows[0].status !== 'suspended') return errorResponse(res, 'Clinic must be suspended before deletion', 400);
    await pool.query('DELETE FROM tenants WHERE id = $1', [id]);
    return successResponse(res, { message: 'Clinic deleted permanently' });
  } catch (err) {
    logger.error(`Error deleting tenant: ${err.code || ''} ${err.constraint || ''} ${err.message}`);
    return errorResponse(res, 'Failed to delete clinic', 500);
  }
}

async function clearTenantConversations(req, res) {
  try {
    const { id } = req.params
    const result = await pool.query(`
      DELETE FROM messages
      WHERE conversation_id IN (SELECT id FROM conversations WHERE tenant_id = $1)
    `, [id])
    return successResponse(res, {
      deleted: result.rowCount,
      message: `Cleared ${result.rowCount} messages for tenant`
    })
  } catch (err) {
    logger.error('Error clearing tenant conversations:', err.message)
    return errorResponse(res, 'Failed to clear conversations', 500)
  }
}

async function getPosterRequests(req, res) {
  try {
    const { status } = req.query;
    let sql = `SELECT pr.*, t.name AS tenant_name FROM poster_requests pr JOIN tenants t ON t.id = pr.tenant_id`;
    const params = [];
    if (status) {
      sql += ` WHERE pr.status = $1`;
      params.push(status);
    }
    sql += ` ORDER BY pr.created_at DESC`;
    const result = await pool.query(sql, params);
    return successResponse(res, result.rows);
  } catch (err) {
    logger.error('Error fetching poster requests:', err.message);
    return errorResponse(res, 'Failed to fetch poster requests', 500);
  }
}

async function approvePosterRequest(req, res) {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE poster_requests SET status = 'approved', reviewed_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return errorResponse(res, 'Poster request not found or already reviewed', 409);
    }
    return successResponse(res, result.rows[0]);
  } catch (err) {
    logger.error('Error approving poster request:', err.message);
    return errorResponse(res, 'Failed to approve poster request', 500);
  }
}

async function rejectPosterRequest(req, res) {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const result = await pool.query(
      `UPDATE poster_requests SET status = 'rejected', reviewed_at = NOW(), notes = $2 WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id, notes || null]
    );
    if (result.rows.length === 0) {
      return errorResponse(res, 'Poster request not found or already reviewed', 409);
    }
    return successResponse(res, result.rows[0]);
  } catch (err) {
    logger.error('Error rejecting poster request:', err.message);
    return errorResponse(res, 'Failed to reject poster request', 500);
  }
}

module.exports = {
  getAllTenants,
  getTenantDetails,
  updateTenantStatus,
  updateTenant,
  syncWhatsappNumber,
  setBookingMode,
  createTenant,
  getPlatformStats,
  clearTenantConversations,
  deleteTenant,
  getPosterRequests,
  approvePosterRequest,
  rejectPosterRequest
};

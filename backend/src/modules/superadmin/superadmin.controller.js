const pool = require('../../config/database');
const { successResponse, errorResponse } = require('../../utils/response');
const logger = require('../../utils/logger');

/**
 * GET /superadmin/tenants
 * Lists all tenants with usage stats
 */
async function getAllTenants(req, res) {
  try {
    const sql = `
      SELECT t.id, t.name, t.plan, t.status, t.industry, t.whatsapp_number, t.created_at,
             (SELECT COUNT(*) FROM bookings b WHERE b.tenant_id = t.id AND b.created_at >= NOW() - INTERVAL '30 days') AS booking_count,
             (SELECT COUNT(*) FROM conversations c WHERE c.tenant_id = t.id AND c.started_at >= NOW() - INTERVAL '30 days') AS conversation_count,
             (SELECT COUNT(*) FROM customers cu WHERE cu.tenant_id = t.id) AS customer_count
      FROM tenants t
      ORDER BY t.created_at DESC
    `;
    const result = await pool.query(sql);
    return successResponse(res, result.rows);
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
    
    return successResponse(res, result.rows[0]);
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
    
    return successResponse(res, result.rows[0]);
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
    const { clinicName, email, password, plan } = req.body;

    if (!clinicName || !email || !password || !plan) {
      return errorResponse(res, 'All fields required', 400);
    }

    if (!['starter', 'growth', 'pro'].includes(plan)) {
      return errorResponse(res, 'Invalid plan', 400);
    }

    const { bcrypt } = require('../../config/auth');
    const password_hash = await bcrypt.hash(password, 12);

    await client.query('BEGIN');

    const tenantResult = await client.query(
      `INSERT INTO tenants (id, name, plan, status, industry, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'pending', 'clinic', NOW(), NOW())
       RETURNING *`,
      [clinicName, plan]
    );

    const tenant = tenantResult.rows[0];

    await client.query(
      `INSERT INTO staff (id, tenant_id, name, email, password_hash, role, is_active, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'admin', true, NOW(), NOW())`,
      [tenant.id, clinicName, email, password_hash]
    );

    await client.query('COMMIT');
    return successResponse(res, tenant, 201);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return errorResponse(res, 'Email already exists', 409);
    }
    logger.error('Error creating tenant:', err.message);
    return errorResponse(res, 'Failed to create tenant', 500);
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
    const { clinicName, plan, whatsappNumber } = req.body;

    const result = await pool.query(
      `UPDATE tenants
       SET name = COALESCE($1, name),
           plan = COALESCE($2, plan),
           whatsapp_number = COALESCE($3, whatsapp_number),
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [clinicName || null, plan || null, whatsappNumber || null, id]
    );

    if (result.rows.length === 0) {
      return errorResponse(res, 'Tenant not found', 404);
    }

    return successResponse(res, result.rows[0]);
  } catch (err) {
    logger.error('Error updating tenant:', err.message);
    return errorResponse(res, 'Failed to update tenant', 500);
  }
}

module.exports = {
  getAllTenants,
  getTenantDetails,
  updateTenantStatus,
  updateTenant,
  createTenant,
  getPlatformStats
};

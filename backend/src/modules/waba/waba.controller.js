const axios = require('axios');
const pool = require('../../config/database');
const { successResponse, errorResponse } = require('../../utils/response');
const logger = require('../../utils/logger');
const { encrypt, decrypt } = require('../../utils/secretBox');
const { normalizeNumber } = require('../tenant/tenant.service');

const META_TOKEN = process.env.META_WHATSAPP_TOKEN;
const WABA_ID = process.env.META_WABA_ID;
const META_API_URL = 'https://graph.facebook.com/v24.0';

// POST /admin/waba/initiate
// Initiates phone number registration with Meta, sends OTP to the number
async function initiateRegistration(req, res) {
  try {
    const { phone_number, tenant_id } = req.body;
    if (!phone_number || !tenant_id) {
      return errorResponse(res, 'phone_number and tenant_id are required', 400);
    }

    // Normalize phone number - remove +91 prefix, keep only digits
    let cc = '91';
    let number = phone_number.replace(/[^\d]/g, '');
    if (number.startsWith('91') && number.length === 12) {
      number = number.slice(2);
    }

    logger.info('Sending to Meta:', { cc, phone_number: number, WABA_ID });
    const response = await axios.post(
      `${META_API_URL}/${WABA_ID}/phone_numbers`,
      {
        cc,
        phone_number: number,
        method: 'SMS',
        migrate_phone_number: true
      },
      {
        headers: {
          Authorization: `Bearer ${META_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    logger.info(`WABA registration initiated for ${phone_number}`);
    return successResponse(res, {
      phone_number_id: response.data.id,
      message: 'OTP sent successfully'
    });
  } catch (err) {
    const metaError = err.response?.data?.error?.message || err.message;
    logger.error('WABA initiate failed:', metaError);
    return errorResponse(res, metaError || 'Failed to initiate registration', 500);
  }
}

// POST /admin/waba/verify
// Verifies OTP and completes registration, assigns number to tenant
async function verifyRegistration(req, res) {
  try {
    const { phone_number_id, code, tenant_id, phone_number } = req.body;
    if (!phone_number_id || !code || !tenant_id) {
      return errorResponse(res, 'phone_number_id, code and tenant_id are required', 400);
    }

    await axios.post(
      `${META_API_URL}/${phone_number_id}/verify_code`,
      { code },
      {
        headers: {
          Authorization: `Bearer ${META_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Update tenant whatsapp_number in DB
    if (phone_number) {
      let normalized = phone_number.replace(/[^\d+]/g, '');
      if (!normalized.startsWith('+')) {
        normalized = '+91' + (normalized.startsWith('91') ? normalized.slice(2) : normalized);
      }
      await pool.query(
        'UPDATE tenants SET whatsapp_number = $1 WHERE id = $2',
        [normalized, tenant_id]
      );
    }

    if (/^\d+$/.test(String(phone_number_id))) {
      await pool.query(
        'UPDATE tenants SET whatsapp_phone_number_id = $1 WHERE id = $2',
        [String(phone_number_id), tenant_id]
      );
    }

    logger.info(`WABA registration verified for tenant ${tenant_id}`);
    return successResponse(res, { message: 'WhatsApp number registered successfully' });
  } catch (err) {
    const metaError = err.response?.data?.error?.message || err.message;
    logger.error('WABA verify failed:', metaError);
    return errorResponse(res, metaError || 'Failed to verify OTP', 500);
  }
}

// GET /admin/waba/status/:phoneNumberId
// Checks registration status of a phone number
async function getStatus(req, res) {
  try {
    const { phoneNumberId } = req.params;
    const response = await axios.get(
      `${META_API_URL}/${phoneNumberId}?fields=verified_name,code_verification_status,display_phone_number,quality_rating`,
      {
        headers: { Authorization: `Bearer ${META_TOKEN}` }
      }
    );
    return successResponse(res, response.data);
  } catch (err) {
    const metaError = err.response?.data?.error?.message || err.message;
    logger.error('WABA status check failed:', metaError);
    return errorResponse(res, metaError || 'Failed to get status', 500);
  }
}

// ---------------------------------------------------------------------------
// Coexistence: connect a clinic's own number and request the one-time data sync
// Tokens, codes and Meta response bodies are never logged or returned.
// ---------------------------------------------------------------------------

const META_ID_PATTERN = /^\d{8,20}$/;   // same pattern senderContext uses for phone number ids
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;
const SYNC_KEY_TTL_SECONDS = 30 * 24 * 60 * 60;
const SYNC_TYPES = ['history', 'smb_app_state_sync'];

// Short, safe description of a failed Meta call: HTTP status and Meta error code/message only
function metaFailure(err) {
  const status = err.response?.status;
  const metaError = err.response?.data?.error;
  const parts = [
    status ? `HTTP ${status}` : null,
    metaError?.code ? `code ${metaError.code}` : null,
    metaError?.message ? String(metaError.message).slice(0, 200) : (err.response ? null : 'no response from Meta')
  ].filter(Boolean);
  return parts.join(' ') || 'request failed';
}

// POST /admin/waba/connect
// Exchanges the Embedded Signup code, subscribes the app to the clinic's WABA, and stores the encrypted token on the tenant
async function connectClinicNumber(req, res) {
  try {
    const { tenantId, code, wabaId, phoneNumberId } = req.body || {};

    // 1. Validate input (nothing is sent to Meta yet)
    if (!tenantId || !UUID_PATTERN.test(String(tenantId))) {
      return errorResponse(res, 'tenantId is required and must be a valid id', 400);
    }
    if (!META_ID_PATTERN.test(String(wabaId || ''))) {
      return errorResponse(res, 'wabaId must be 8-20 digits', 400);
    }
    if (!META_ID_PATTERN.test(String(phoneNumberId || ''))) {
      return errorResponse(res, 'phoneNumberId must be 8-20 digits', 400);
    }
    if (code !== undefined && code !== null && typeof code !== 'string') {
      return errorResponse(res, 'code must be a string', 400);
    }
    const tenantRes = await pool.query(
      `SELECT id, whatsapp_number, whatsapp_waba_id, whatsapp_phone_number_id,
              whatsapp_access_token_enc, whatsapp_connected_at
       FROM tenants WHERE id = $1`,
      [tenantId]
    );
    if (!tenantRes.rows.length) {
      return errorResponse(res, 'Tenant not found', 400);
    }
    const tenantRow = tenantRes.rows[0];

    // Without a code this is a retry (for example after a failed subscribe): it needs a token already stored for the same ids
    const hasCode = typeof code === 'string' && code.trim() !== '';
    const isRetry = !hasCode;
    if (isRetry) {
      const sameConnection = !!tenantRow.whatsapp_access_token_enc &&
        tenantRow.whatsapp_waba_id === String(wabaId) &&
        tenantRow.whatsapp_phone_number_id === String(phoneNumberId);
      if (!sameConnection) {
        return errorResponse(res, 'code is required', 400);
      }
    }

    // 2. Fail before calling Meta when the server is not configured
    try {
      encrypt('configuration-check');
    } catch (keyErr) {
      return errorResponse(res, 'TOKEN_ENCRYPTION_KEY is not configured on the server', 500);
    }
    if (!process.env.META_APP_ID) {
      return errorResponse(res, 'META_APP_ID is not configured on the server', 500);
    }
    if (!process.env.META_APP_SECRET) {
      return errorResponse(res, 'META_APP_SECRET is not configured on the server', 500);
    }

    // 3. The phone number id must not belong to another clinic
    const inUse = await pool.query(
      'SELECT id FROM tenants WHERE whatsapp_phone_number_id = $1 AND id <> $2',
      [String(phoneNumberId), tenantId]
    );
    if (inUse.rows.length) {
      return errorResponse(res, 'This Phone Number ID is already assigned to another clinic', 409);
    }

    const clearTenantCache = async (numbers) => {
      try {
        const redisClient = require('../../config/redis');
        for (const number of numbers) {
          if (number) await redisClient.del(`tenant_wa:${normalizeNumber(String(number))}`);
        }
      } catch (_) {}
    };

    // 4. Get the clinic's business token
    let businessToken;
    let connectedAtMs;
    if (isRetry) {
      // Retry without a code: use the stored token and keep the original connect time (the 24-hour sync clock keeps running)
      try {
        businessToken = decrypt(tenantRow.whatsapp_access_token_enc);
      } catch (decryptErr) {
        return errorResponse(res, 'The stored token could not be decrypted (check TOKEN_ENCRYPTION_KEY)', 500);
      }
      connectedAtMs = tenantRow.whatsapp_connected_at ? new Date(tenantRow.whatsapp_connected_at).getTime() : Date.now();
    } else {
      // Exchange the single-use code (server to server)
      try {
        const tokenRes = await axios.get(`${META_API_URL}/oauth/access_token`, {
          params: {
            client_id: process.env.META_APP_ID,
            client_secret: process.env.META_APP_SECRET,
            code
          }
        });
        businessToken = tokenRes.data?.access_token;
      } catch (exchangeErr) {
        logger.warn(`WABA connect: code exchange failed for tenant ${tenantId}: ${metaFailure(exchangeErr)}`);
        return errorResponse(res, `Meta code exchange failed (${metaFailure(exchangeErr)})`, 502);
      }
      if (!businessToken) {
        logger.warn(`WABA connect: code exchange returned no token for tenant ${tenantId}`);
        return errorResponse(res, 'Meta code exchange returned no access token', 502);
      }

      // Save the token right away: the code cannot be used again, so a failed subscribe must not lose it
      try {
        await pool.query(
          `UPDATE tenants
           SET whatsapp_phone_number_id = $1,
               whatsapp_waba_id = $2,
               whatsapp_access_token_enc = $3,
               whatsapp_connected_at = NOW(),
               updated_at = NOW()
           WHERE id = $4`,
          [String(phoneNumberId), String(wabaId), encrypt(businessToken), tenantId]
        );
      } catch (storeErr) {
        if (storeErr.code === '23505') {
          return errorResponse(res, 'This Phone Number ID is already assigned to another clinic', 409);
        }
        logger.error(`WABA connect: storing the token failed for tenant ${tenantId}: ${storeErr.message}`);
        return errorResponse(res, 'Failed to store the connection', 500);
      }
      connectedAtMs = Date.now();
      await clearTenantCache([tenantRow.whatsapp_number]);
    }
    const authHeaders = { Authorization: `Bearer ${businessToken}` };

    // 5. Subscribe the app to the clinic's WABA (the token is already saved, so this can be repeated without the code)
    try {
      await axios.post(`${META_API_URL}/${wabaId}/subscribed_apps`, {}, { headers: authHeaders });
    } catch (subscribeErr) {
      logger.warn(`WABA connect: subscribed_apps failed for tenant ${tenantId}: ${metaFailure(subscribeErr)}`);
      return errorResponse(
        res,
        `Could not subscribe the app to the WABA (${metaFailure(subscribeErr)}). The token was saved: call /connect again without the code to repeat the subscription.`,
        502
      );
    }

    // 6. No register call: coexistence numbers are already registered

    // 7. Read the number's details (not fatal: the code is single use, so the token is stored even if this read fails)
    let isOnBizApp = null;
    let platformType = null;
    let displayNumber = null;
    let detailsWarning = null;
    try {
      const phoneRes = await axios.get(`${META_API_URL}/${phoneNumberId}`, {
        params: { fields: 'display_phone_number,is_on_biz_app,platform_type' },
        headers: authHeaders
      });
      isOnBizApp = phoneRes.data?.is_on_biz_app ?? null;
      platformType = phoneRes.data?.platform_type ?? null;
      displayNumber = phoneRes.data?.display_phone_number || null;
    } catch (detailsErr) {
      detailsWarning = `Could not read the number details from Meta (${metaFailure(detailsErr)})`;
      logger.warn(`WABA connect: number details failed for tenant ${tenantId}: ${metaFailure(detailsErr)}`);
    }

    // 8. The visible number is only filled in when the tenant has none (a separate small update: the connection is already stored)
    const normalizedDisplay = displayNumber ? normalizeNumber(String(displayNumber)) : null;
    if (normalizedDisplay) {
      try {
        await pool.query(
          `UPDATE tenants
           SET whatsapp_number = $1::text, updated_at = NOW()
           WHERE id = $2 AND (whatsapp_number IS NULL OR whatsapp_number = '')`,
          [normalizedDisplay, tenantId]
        );
      } catch (numberErr) {
        if (numberErr.code === '23505') {
          detailsWarning = 'The number shown by Meta is already assigned to another clinic, so the clinic number was not set';
        } else {
          logger.warn(`WABA connect: setting the clinic number failed for tenant ${tenantId}: ${numberErr.message}`);
        }
      }
    }

    // 9. Drop cached copies of this tenant (lookup by incoming number)
    await clearTenantCache([tenantRow.whatsapp_number, normalizedDisplay]);

    logger.info(`WABA connect: tenant ${tenantId} connected (phone number id ${phoneNumberId}${isRetry ? ', retry without code' : ''})`);

    // 10. The token is never part of the response; the sync deadline follows the first connect
    return successResponse(res, {
      connected: true,
      wabaId: String(wabaId),
      phoneNumberId: String(phoneNumberId),
      isOnBizApp,
      platformType,
      syncDeadline: new Date(connectedAtMs + SYNC_WINDOW_MS).toISOString(),
      ...(detailsWarning ? { warning: detailsWarning } : {})
    });
  } catch (err) {
    logger.error(`WABA connect failed: ${err.message}`);
    return errorResponse(res, 'Failed to connect the clinic number', 500);
  }
}

// POST /admin/waba/sync
// Asks Meta for the one-time history or contacts/app-state sync of a coexistence number (within 24 hours of connecting)
async function requestSync(req, res) {
  try {
    const { tenantId, syncType } = req.body || {};
    if (!tenantId || !UUID_PATTERN.test(String(tenantId))) {
      return errorResponse(res, 'tenantId is required and must be a valid id', 400);
    }
    if (!SYNC_TYPES.includes(syncType)) {
      return errorResponse(res, 'syncType must be "history" or "smb_app_state_sync"', 400);
    }

    const tenantRes = await pool.query(
      'SELECT whatsapp_phone_number_id, whatsapp_connected_at, whatsapp_access_token_enc FROM tenants WHERE id = $1',
      [tenantId]
    );
    if (!tenantRes.rows.length) {
      return errorResponse(res, 'Tenant not found', 404);
    }
    const tenantRow = tenantRes.rows[0];
    if (!tenantRow.whatsapp_access_token_enc || !tenantRow.whatsapp_phone_number_id) {
      return errorResponse(res, 'This clinic has no connected WhatsApp number or stored token', 400);
    }

    let tenantToken;
    try {
      tenantToken = decrypt(tenantRow.whatsapp_access_token_enc);
    } catch (decryptErr) {
      return errorResponse(res, 'The stored token could not be decrypted (check TOKEN_ENCRYPTION_KEY)', 500);
    }

    // Meta only allows the sync within 24 hours of connecting
    const connectedAt = tenantRow.whatsapp_connected_at ? new Date(tenantRow.whatsapp_connected_at).getTime() : null;
    if (!connectedAt || Date.now() - connectedAt > SYNC_WINDOW_MS) {
      return errorResponse(res, 'More than 24 hours have passed since the number was connected. The clinic must disconnect and onboard again.', 409);
    }

    // Each sync type can be requested once
    const redisClient = require('../../config/redis');
    const syncKey = `waba_sync:${tenantId}:${syncType}`;
    try {
      if (await redisClient.get(syncKey)) {
        return errorResponse(res, `The ${syncType} sync was already requested for this clinic`, 409);
      }
    } catch (redisErr) {
      logger.error(`WABA sync: could not check previous requests for tenant ${tenantId}: ${redisErr.message}`);
      return errorResponse(res, 'Could not check whether this sync was already requested', 500);
    }

    let requestId = null;
    try {
      const syncRes = await axios.post(
        `${META_API_URL}/${tenantRow.whatsapp_phone_number_id}/smb_app_data`,
        { messaging_product: 'whatsapp', sync_type: syncType },
        { headers: { Authorization: `Bearer ${tenantToken}` } }
      );
      requestId = syncRes.data?.request_id || null;
    } catch (syncErr) {
      logger.warn(`WABA sync: ${syncType} request failed for tenant ${tenantId}: ${metaFailure(syncErr)}`);
      return errorResponse(res, `Meta rejected the ${syncType} sync request (${metaFailure(syncErr)})`, 502);
    }

    // Remember the request only after Meta accepted it
    try {
      await redisClient.set(syncKey, '1', { EX: SYNC_KEY_TTL_SECONDS });
    } catch (redisErr) {
      logger.warn(`WABA sync: could not record the ${syncType} request for tenant ${tenantId}: ${redisErr.message}`);
    }

    logger.info(`WABA sync: ${syncType} requested for tenant ${tenantId} (request id ${requestId || 'none'})`);
    return successResponse(res, { requested: true, requestId });
  } catch (err) {
    logger.error(`WABA sync failed: ${err.message}`);
    return errorResponse(res, 'Failed to request the sync', 500);
  }
}

module.exports = { initiateRegistration, verifyRegistration, getStatus, connectClinicNumber, requestSync };

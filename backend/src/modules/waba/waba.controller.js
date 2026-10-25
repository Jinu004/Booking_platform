const axios = require('axios');
const pool = require('../../config/database');
const { successResponse, errorResponse } = require('../../utils/response');
const logger = require('../../utils/logger');
const { encrypt, decrypt } = require('../../utils/secretBox');
const { normalizeNumber } = require('../tenant/tenant.service');

const META_API_URL = 'https://graph.facebook.com/v24.0';

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
    // phoneNumberId is optional: when it is missing it is looked up from the WABA after the token is known
    const hasPhoneNumberId = phoneNumberId !== undefined && phoneNumberId !== null && phoneNumberId !== '';
    if (hasPhoneNumberId && !META_ID_PATTERN.test(String(phoneNumberId))) {
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

    // Without a code this is a retry (for example after a failed subscribe or lookup): it needs a token already stored for the same WABA,
    // and a phone number id (when given) that does not contradict the one already stored
    const hasCode = typeof code === 'string' && code.trim() !== '';
    const isRetry = !hasCode;
    if (isRetry) {
      const sameConnection = !!tenantRow.whatsapp_access_token_enc &&
        tenantRow.whatsapp_waba_id === String(wabaId) &&
        !(hasPhoneNumberId && tenantRow.whatsapp_phone_number_id && tenantRow.whatsapp_phone_number_id !== String(phoneNumberId));
      if (!sameConnection) {
        return errorResponse(res, 'code is required', 400);
      }
    }

    // The phone number id to use: the request's, else (on a retry) the stored one, else it is looked up from the WABA below
    let phoneId = hasPhoneNumberId
      ? String(phoneNumberId)
      : (isRetry && tenantRow.whatsapp_phone_number_id ? tenantRow.whatsapp_phone_number_id : null);

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

    // 3. The phone number id must not belong to another clinic (checked again later if the id is only found after the exchange)
    const isUsedByAnotherTenant = async (id) => {
      const inUse = await pool.query(
        'SELECT id FROM tenants WHERE whatsapp_phone_number_id = $1 AND id <> $2',
        [String(id), tenantId]
      );
      return inUse.rows.length > 0;
    };
    if (phoneId && await isUsedByAnotherTenant(phoneId)) {
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

      // Save the token right away: the code cannot be used again, so a failed lookup or subscribe must not lose it.
      // When the phone number id is not known yet, the stored one is left unchanged.
      try {
        await pool.query(
          `UPDATE tenants
           SET whatsapp_phone_number_id = COALESCE($1, whatsapp_phone_number_id),
               whatsapp_waba_id = $2,
               whatsapp_access_token_enc = $3,
               whatsapp_connected_at = NOW(),
               updated_at = NOW()
           WHERE id = $4`,
          [phoneId, String(wabaId), encrypt(businessToken), tenantId]
        );
      } catch (storeErr) {
        if (storeErr.code === '23505') {
          return errorResponse(res, 'This Phone Number ID is already assigned to another clinic', 409);
        }
        logger.error(`WABA connect: storing the token failed for tenant ${tenantId}: ${storeErr.message}`);
        return errorResponse(res, 'Failed to store the connection', 500);
      }
      connectedAtMs = Date.now();
      // The sender caches a clinic's token for up to a minute: forget it so the new connection is used at once
      require('../channel/whatsapp/senderContext').clearTenantTokenCache(tenantId);
      await clearTenantCache([tenantRow.whatsapp_number]);
    }
    const authHeaders = { Authorization: `Bearer ${businessToken}` };

    // 4b. Phone number id still unknown: look it up from the WABA with the business token.
    // The token is already saved at this point, so every failure below can be repeated by calling /connect again without the code.
    let phoneIdFromLookup = false;
    if (!phoneId) {
      let numbers;
      try {
        const listRes = await axios.get(`${META_API_URL}/${wabaId}/phone_numbers`, {
          params: { fields: 'id,display_phone_number' },
          headers: authHeaders
        });
        numbers = Array.isArray(listRes.data?.data) ? listRes.data.data : [];
      } catch (listErr) {
        logger.warn(`WABA connect: phone number lookup failed for tenant ${tenantId}: ${metaFailure(listErr)}`);
        return errorResponse(
          res,
          `The token was saved, but the numbers of this WABA could not be listed (${metaFailure(listErr)}). Call /connect again without the code and with phoneNumberId.`,
          409
        );
      }
      if (numbers.length !== 1) {
        const described = numbers.map(n => `${String(n.id)} (${n.display_phone_number || 'unknown number'})`).join(', ');
        return errorResponse(
          res,
          `The token was saved, but this WABA has ${numbers.length} phone number(s)${numbers.length ? `: ${described}` : ''}. Call /connect again without the code and with phoneNumberId.`,
          409
        );
      }
      const foundId = String(numbers[0].id || '');
      if (!META_ID_PATTERN.test(foundId)) {
        return errorResponse(res, 'The token was saved, but Meta returned an unexpected phone number id. Call /connect again without the code and with phoneNumberId.', 409);
      }
      phoneId = foundId;
      phoneIdFromLookup = true;
      if (await isUsedByAnotherTenant(phoneId)) {
        return errorResponse(res, 'This Phone Number ID is already assigned to another clinic (the token was saved)', 409);
      }
    }

    // Store the phone number id when it was not stored together with the exchange (found by lookup, or given on a retry)
    if (phoneIdFromLookup || (isRetry && tenantRow.whatsapp_phone_number_id !== phoneId)) {
      try {
        await pool.query(
          'UPDATE tenants SET whatsapp_phone_number_id = $1, updated_at = NOW() WHERE id = $2',
          [phoneId, tenantId]
        );
      } catch (phoneStoreErr) {
        if (phoneStoreErr.code === '23505') {
          return errorResponse(res, 'This Phone Number ID is already assigned to another clinic (the token was saved)', 409);
        }
        logger.error(`WABA connect: storing the phone number id failed for tenant ${tenantId}: ${phoneStoreErr.message}`);
        return errorResponse(res, 'Failed to store the phone number id', 500);
      }
    }

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
      const phoneRes = await axios.get(`${META_API_URL}/${phoneId}`, {
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

    // 8. Meta is the source of truth for the visible number: always write what Meta shows (a separate small update: the connection is already stored)
    const normalizedDisplay = displayNumber ? normalizeNumber(String(displayNumber)) : null;
    if (normalizedDisplay) {
      try {
        await pool.query(
          `UPDATE tenants
           SET whatsapp_number = $1::text, updated_at = NOW()
           WHERE id = $2`,
          [normalizedDisplay, tenantId]
        );
      } catch (numberErr) {
        if (numberErr.code === '23505') {
          // Another clinic holds this number: Connect still succeeds and the old value stays
          logger.warn(`WHATSAPP_NUMBER_CONFLICT tenant=${tenantId}`);
          detailsWarning = 'The number shown by Meta is already assigned to another clinic, so the clinic number was not changed';
        } else {
          logger.warn(`WABA connect: setting the clinic number failed for tenant ${tenantId}: ${numberErr.message}`);
        }
      }
    }

    // 9. Drop cached copies of this tenant (lookup by incoming number)
    await clearTenantCache([tenantRow.whatsapp_number, normalizedDisplay]);

    // Record the connection state (not fatal: the connection itself is already stored)
    try {
      const TenantService = require('../tenant/tenant.service');
      // wa_state_changed_at is written by webhook events only (Meta's event time); the connect time is whatsapp_connected_at
      await TenantService.setConfig(tenantId, 'wa_connection_state', 'connected');
    } catch (stateErr) {
      logger.warn(`WABA connect: recording the connection state failed for tenant ${tenantId}: ${stateErr.message}`);
    }

    logger.info(`WABA connect: tenant ${tenantId} connected (phone number id ${phoneId}${isRetry ? ', retry without code' : ''})`);

    // 10. The token is never part of the response; the sync deadline follows the first connect
    return successResponse(res, {
      connected: true,
      wabaId: String(wabaId),
      phoneNumberId: phoneId,
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

module.exports = { connectClinicNumber, requestSync };

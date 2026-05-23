const axios = require('axios');
const pool = require('../../config/database');
const { successResponse, errorResponse } = require('../../utils/response');
const logger = require('../../utils/logger');

const META_TOKEN = process.env.META_WHATSAPP_TOKEN;
const WABA_ID = process.env.META_WABA_ID;
const META_API_URL = 'https://graph.facebook.com/v18.0';

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

module.exports = { initiateRegistration, verifyRegistration, getStatus };

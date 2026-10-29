// The one implementation of the WhatsApp webhook signature check, used twice:
//   1. by the webhook JSON parser's verify step in index.js (webhookVerify): a request with a missing or wrong signature is answered
//      before its body is parsed;
//   2. by the POST route in whatsapp.webhook.js (checkWebhookSignature): the second guard, which also catches requests the parser skips
//      (empty bodies, non-JSON content types) and keeps the non-production rule (only Meta-shaped payloads are checked).
// Rules (unchanged): header x-hub-signature-256, HMAC-SHA256 over the exact raw bytes, length check then crypto.timingSafeEqual.
// In production every payload needs a valid signature and a missing secret gives 503. The secret and the body are never logged.
const crypto = require('crypto');
const logger = require('../../../utils/logger');

/**
 * @param {{ signature?: string, rawBody?: Buffer, secret?: string, isProduction: boolean, isMetaPayload?: boolean, ip?: string }} input
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
function checkWebhookSignature({ signature, rawBody, secret, isProduction, isMetaPayload = false, ip }) {
  if (isProduction && !secret) {
    logger.error('META_APP_SECRET not set — rejecting webhook');
    return { ok: false, status: 503, error: 'Webhook not configured' };
  }
  if (secret && (isProduction || isMetaPayload)) {
    // The raw body is the exact bytes received (captured by the JSON parser's verify step, never re-serialised)
    if (!signature || !Buffer.isBuffer(rawBody)) {
      logger.warn(`WEBHOOK_REJECTED_UNSIGNED ip=${ip} reason=${signature ? 'no_raw_body' : 'missing_signature'}`);
      return { ok: false, status: 403, error: 'Missing signature' };
    }
    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    const sigBuffer = Buffer.from(String(signature));
    const expectedBuffer = Buffer.from(expectedSignature);
    const valid = sigBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    if (!valid) {
      logger.warn(`WEBHOOK_REJECTED_UNSIGNED ip=${ip} reason=invalid_signature`);
      return { ok: false, status: 403, error: 'Invalid signature' };
    }
  }
  return { ok: true };
}

// The verify callback of the webhook JSON parser (index.js). It keeps the raw bytes and, in production, checks the signature
// before body-parser parses anything. A rejection is thrown as an error carrying webhookReject; body-parser passes it on (as a 403)
// to webhookRejectHandler below. Outside production nothing is checked here (the route-level check needs the parsed payload).
function webhookVerify(req, res, buf) {
  req.rawBody = buf;
  if (process.env.NODE_ENV !== 'production') return;
  const result = checkWebhookSignature({
    signature: req.headers['x-hub-signature-256'],
    rawBody: buf,
    secret: process.env.META_APP_SECRET,
    isProduction: true,
    ip: req.ip
  });
  if (!result.ok) {
    const rejection = new Error('webhook signature rejected');
    rejection.webhookReject = { status: result.status, error: result.error };
    throw rejection;
  }
}

// Registered right after the webhook parser. It answers only the rejections above, with exactly the response the route gave before,
// and never logs the error (body-parser attaches the raw request body to it). Every other error goes on to the global error handler.
function webhookRejectHandler(err, req, res, next) {
  if (err && err.webhookReject) {
    return res.status(err.webhookReject.status).json({ success: false, error: err.webhookReject.error });
  }
  return next(err);
}

// WEBHOOK_SIZE bucket for the size of an accepted request body (binary units: 1m = 1,048,576 bytes)
function sizeBucket(bytes) {
  if (bytes < 10 * 1024) return 'lt10k';
  if (bytes < 100 * 1024) return 'lt100k';
  if (bytes < 500 * 1024) return 'lt500k';
  if (bytes < 1024 * 1024) return 'lt1m';
  if (bytes < 3 * 1024 * 1024) return 'lt3m';
  return 'gte3m';
}

// Timing-safe comparison of two strings of any length (both are hashed first, so different lengths never throw)
function tokensMatch(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  const a = crypto.createHash('sha256').update(received).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { checkWebhookSignature, webhookVerify, webhookRejectHandler, sizeBucket, tokensMatch };

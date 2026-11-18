const webpush = require('web-push');
const pool = require('../../config/database');
const logger = require('../../utils/logger');

webpush.setVapidDetails(
  'mailto:support@receptionai.in',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// A push subscription is accepted (and later used) only when its endpoint is an https URL of a known browser push service,
// so the server never posts notifications to an arbitrary address.
const PUSH_HOSTS_EXACT = ['fcm.googleapis.com', 'web.push.apple.com'];
const PUSH_HOST_SUFFIXES = ['.push.services.mozilla.com', '.notify.windows.com', '.push.apple.com'];

function isValidPushEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 1000) return false;
  let url;
  try { url = new URL(endpoint); } catch (_) { return false; }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS_EXACT.includes(host) || PUSH_HOST_SUFFIXES.some(suffix => host.endsWith(suffix));
}

// The shape web-push needs: { endpoint, keys: { p256dh, auth } }, each key a string of at most 200 characters
function isValidPushSubscription(subscription) {
  if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) return false;
  if (!isValidPushEndpoint(subscription.endpoint)) return false;
  const keys = subscription.keys;
  if (!keys || typeof keys !== 'object') return false;
  for (const field of ['p256dh', 'auth']) {
    if (typeof keys[field] !== 'string' || keys[field].length === 0 || keys[field].length > 200) return false;
  }
  return true;
}

async function saveSubscription(tenantId, staffId, subscription) {
  await pool.query(
    `INSERT INTO push_subscriptions (tenant_id, staff_id, subscription, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (staff_id) DO UPDATE SET subscription = $3, created_at = NOW()`,
    [tenantId, staffId, JSON.stringify(subscription)]
  );
}

async function sendPushToTenant(tenantId, payload) {
  try {
    const result = await pool.query(
      'SELECT subscription FROM push_subscriptions WHERE tenant_id = $1',
      [tenantId]
    );
    let sent = 0;
    for (const row of result.rows) {
      try {
        const subscription = JSON.parse(row.subscription);
        // Rows stored before the endpoint check are not used when they fail it
        if (!isValidPushSubscription(subscription)) {
          logger.warn(`Push notification skipped: stored subscription failed the endpoint check (tenant=${tenantId})`);
          continue;
        }
        await webpush.sendNotification(
          subscription,
          JSON.stringify(payload)
        );
        sent++;
      } catch (err) {
        logger.warn('Push notification failed:', err.message);
        if (err.statusCode === 410) {
          // Subscription expired - remove it
          await pool.query(
            'DELETE FROM push_subscriptions WHERE subscription = $1',
            [row.subscription]
          );
        }
      }
    }
    return { total: result.rows.length, sent };
  } catch (err) {
    logger.error('sendPushToTenant failed:', err.message);
    return { total: 0, sent: 0, error: true };
  }
}

module.exports = { saveSubscription, sendPushToTenant, isValidPushSubscription };

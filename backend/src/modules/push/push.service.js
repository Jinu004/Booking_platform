const webpush = require('web-push');
const pool = require('../../config/database');
const logger = require('../../utils/logger');

webpush.setVapidDetails(
  'mailto:support@receptionai.in',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

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
    for (const row of result.rows) {
      try {
        await webpush.sendNotification(
          JSON.parse(row.subscription),
          JSON.stringify(payload)
        );
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
  } catch (err) {
    logger.error('sendPushToTenant failed:', err.message);
  }
}

module.exports = { saveSubscription, sendPushToTenant };

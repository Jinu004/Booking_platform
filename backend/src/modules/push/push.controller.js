const { saveSubscription } = require('./push.service');
const { successResponse, errorResponse } = require('../../utils/response');

async function subscribe(req, res) {
  try {
    const { subscription } = req.body;
    if (!subscription) return errorResponse(res, 'Subscription required', 400);
    await saveSubscription(req.tenantId, req.staff.id, subscription);
    return successResponse(res, { message: 'Subscribed to push notifications' });
  } catch (err) {
    return errorResponse(res, 'Failed to save subscription', 500);
  }
}

async function getVapidKey(req, res) {
  return res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
}

module.exports = { subscribe, getVapidKey };

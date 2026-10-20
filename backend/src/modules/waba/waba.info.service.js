const axios = require('axios');
const logger = require('../../utils/logger');
const { loadConnection, metaFailure, TemplateError, META_API_URL } = require('./waba.templates.service');

// Strictly read only: every request below is an HTTP GET to Meta, with the clinic's OWN WABA id, phone number id and token.
// Nothing is written to Meta or to our database, and no setting is ever enabled or changed.

const REQUEST_TIMEOUT_MS = 8000;
const BATCH_SIZE = 5;
const EDGE_LIMIT = 10;
const DAY_SECONDS = 24 * 60 * 60;

const WABA_FIELDS = [
  'name', 'status', 'currency', 'timezone_id', 'country', 'message_template_namespace',
  'business_verification_status', 'health_status', 'primary_funding_id', 'ownership_type',
  'is_shared_with_partners', 'whatsapp_business_manager_messaging_limit', 'marketing_messages_onboarding_status'
];

const PHONE_FIELDS = [
  'verified_name', 'display_phone_number', 'quality_rating', 'code_verification_status', 'status', 'throughput',
  'name_status', 'is_on_biz_app', 'platform_type', 'health_status',
  // best effort: not confirmed in Meta's documentation, an error is an acceptable result
  'messaging_limit_tier', 'quality_score', 'account_mode', 'last_onboarded_time', 'is_official_business_account', 'new_name_status'
];

const WABA_EDGES = ['phone_numbers', 'subscribed_apps', 'assigned_users', 'activities', 'solutions'];

// Analytics for the last 30 days, daily, from UTC midnight to UTC midnight. Lists are written as JSON arrays,
// as in Meta's conversation analytics examples; if Meta rejects a form, its own error is returned instead of guessing.
function analyticsFields() {
  const end = Math.floor(Date.now() / 1000 / DAY_SECONDS) * DAY_SECONDS;
  const start = end - 30 * DAY_SECONDS;
  return {
    pricing_analytics: `pricing_analytics.start(${start}).end(${end}).granularity(DAILY).metric_types(["COST","VOLUME"]).dimensions(["PRICING_CATEGORY"])`,
    conversation_analytics: `conversation_analytics.start(${start}).end(${end}).granularity(DAILY).metric_types(["COST","CONVERSATION"])`
  };
}

async function runBatches(tasks) {
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    await Promise.all(tasks.slice(i, i + BATCH_SIZE).map(task => task()));
  }
}

/**
 * Fetches a clinic's WhatsApp account information from Meta. Each item is its own request, so one failure hides nothing else.
 * @returns {Promise<object>} { fetched_at, waba, phone, edges, analytics } with { ok, value } or { ok, error } per item
 */
async function fetchWabaInfo(tenantId) {
  const { wabaId, phoneNumberId, token } = await loadConnection(tenantId);
  if (!phoneNumberId) {
    throw new TemplateError('This clinic has no phone number id saved. Connect the number first.', 400);
  }

  const headers = { Authorization: `Bearer ${token}` };
  const result = { fetched_at: new Date().toISOString(), waba: {}, phone: {}, edges: {}, analytics: {} };
  let okCount = 0;
  let failedCount = 0;

  const record = (group, key, outcome) => {
    result[group][key] = outcome;
    if (outcome.ok) okCount++; else failedCount++;
  };

  // value of a single field request: the field itself, without the id wrapper
  const fieldTask = (group, nodeId, field) => async () => {
    try {
      const res = await axios.get(`${META_API_URL}/${nodeId}`, { headers, params: { fields: field }, timeout: REQUEST_TIMEOUT_MS });
      record(group, field, { ok: true, value: res.data?.[field.split('.')[0]] ?? null });
    } catch (err) {
      record(group, field, { ok: false, error: err.response ? metaFailure(err) : 'request failed or timed out' });
    }
  };

  const edgeTask = (edge) => async () => {
    try {
      const res = await axios.get(`${META_API_URL}/${wabaId}/${edge}`, { headers, params: { limit: EDGE_LIMIT }, timeout: REQUEST_TIMEOUT_MS });
      // only the data: paging links can carry the access token
      record('edges', edge, { ok: true, value: Array.isArray(res.data?.data) ? res.data.data : [] });
    } catch (err) {
      record('edges', edge, { ok: false, error: err.response ? metaFailure(err) : 'request failed or timed out' });
    }
  };

  const analytics = analyticsFields();
  const analyticsTask = (key) => async () => {
    try {
      const res = await axios.get(`${META_API_URL}/${wabaId}`, { headers, params: { fields: analytics[key] }, timeout: REQUEST_TIMEOUT_MS });
      record('analytics', key, { ok: true, value: res.data?.[key] ?? null });
    } catch (err) {
      record('analytics', key, { ok: false, error: err.response ? metaFailure(err) : 'request failed or timed out' });
    }
  };

  const tasks = [
    ...WABA_FIELDS.map(field => fieldTask('waba', wabaId, field)),
    ...PHONE_FIELDS.map(field => fieldTask('phone', phoneNumberId, field)),
    ...WABA_EDGES.map(edge => edgeTask(edge)),
    ...Object.keys(analytics).map(key => analyticsTask(key))
  ];
  await runBatches(tasks);

  logger.info(`FETCH_WABA_INFO tenant=${tenantId} ok=${okCount} failed=${failedCount}`);
  return result;
}

module.exports = { fetchWabaInfo };

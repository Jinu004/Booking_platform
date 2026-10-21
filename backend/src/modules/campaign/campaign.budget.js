const pool = require('../../config/database')
const C = require('./campaign.config')

// Daily budget and first-campaign cap, shared by the sender and by the preview and confirm endpoints.
// The sender calls this too, so both always count the same way.

// Used only when a readiness result carries no tier at all (a ready clinic always has one, so the sender never sees this)
const DEFAULT_DAILY_LIMIT = 250

// IST hour is 10 <= hour < 19 (see campaign.config.js)
function isSendWindowOpen() {
  const hour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getHours()
  return hour >= C.WINDOW_START_HOUR && hour < C.WINDOW_END_HOUR
}

/**
 * The ONE definition of "first campaign" (preview, confirm and sender all get it through getBudgetSnapshot below).
 * A campaign is the first one only if no OTHER campaign of the clinic has sent anything (a recipient with sent_at set),
 * whatever that campaign's status is: completed, cancelled or paused all count once they sent. The campaign's own sent rows
 * do not count, so it stays "first" (and capped) until it ends.
 */
async function isFirstCampaign(tenantId, campaignId) {
  const res = await pool.query(
    `SELECT NOT EXISTS (
       SELECT 1 FROM campaigns cp
       WHERE cp.tenant_id = $1 AND cp.id <> $2
         AND EXISTS (SELECT 1 FROM campaign_recipients r WHERE r.campaign_id = cp.id AND r.sent_at IS NOT NULL)
     ) AS is_first`,
    [tenantId, campaignId]
  )
  return res.rows[0].is_first === true
}

/**
 * The clinic's daily allowance: the tier limit, the share of it we may use, what the last 24 hours already used
 * (campaign sends plus the notifications table, which also holds the weekly recall sends) and what is left.
 * Used by the campaign budget below and by the weekly recall cron.
 * @param {string} tenantId
 * @param {object} readinessDetails - getSendReadiness(...).details (daily_limit: number, or null for unlimited)
 * @returns {Promise<{ limit, budget, used, remaining }>} limit, budget and remaining are null when the tier has no limit
 */
async function getDailyAllowance(tenantId, readinessDetails) {
  // The rolling 24 hours of every template send of this clinic: campaign sends and the notifications table
  const usedRes = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM campaign_recipients WHERE tenant_id = $1 AND sent_at > now() - interval '24 hours') +
       (SELECT COUNT(*)::int FROM notifications WHERE tenant_id = $1 AND status IN ('sent', 'unknown') AND sent_at > now() - interval '24 hours') AS used`,
    [tenantId]
  )
  const used = usedRes.rows[0].used

  const rawLimit = readinessDetails?.daily_limit
  const limit = rawLimit === null ? null : (Number.isFinite(rawLimit) ? rawLimit : DEFAULT_DAILY_LIMIT)
  const budget = limit === null ? null : Math.floor(limit * C.BUDGET_FRACTION)
  const remaining = budget === null ? null : budget - used
  return { limit, budget, used, remaining }
}

/**
 * @param {string} tenantId
 * @param {string} campaignId
 * @param {object} readinessDetails - getSendReadiness(...).details (daily_limit: number, or null for unlimited)
 * @returns {Promise<{ limit, budget, used, remaining, isFirstCampaign, firstCampaignLimit, firstCampaignRemaining, dailyCap, dailyCapRemaining, canSendNow }>}
 *   limit, budget and remaining are null when the tier has no limit; firstCampaignRemaining is null when this is not the first campaign;
 *   dailyCapRemaining is null when campaigns.daily_cap is not set.
 */
async function getBudgetSnapshot(tenantId, campaignId, readinessDetails) {
  const { limit, budget, used, remaining } = await getDailyAllowance(tenantId, readinessDetails)

  // First campaign of the clinic: capped in total
  const isFirst = await isFirstCampaign(tenantId, campaignId)
  const firstRes = await pool.query(
    `SELECT (SELECT COUNT(*)::int FROM campaign_recipients WHERE campaign_id = $2 AND sent_at IS NOT NULL) AS sent_total,
            (SELECT COUNT(*)::int FROM campaign_recipients WHERE campaign_id = $2 AND sent_at > now() - interval '24 hours') AS sent_24h,
            (SELECT daily_cap FROM campaigns WHERE id = $2 AND tenant_id = $1) AS daily_cap`,
    [tenantId, campaignId]
  )
  const { sent_total: sentTotal, sent_24h: sent24h, daily_cap: dailyCap } = firstRes.rows[0]
  const firstCampaignRemaining = isFirst ? C.FIRST_CAMPAIGN_LIMIT - sentTotal : null
  const dailyCapRemaining = dailyCap && dailyCap > 0 ? dailyCap - sent24h : null

  const canSendNow =
    (remaining === null || remaining > 0) &&
    (firstCampaignRemaining === null || firstCampaignRemaining > 0) &&
    (dailyCapRemaining === null || dailyCapRemaining > 0)

  return {
    limit,
    budget,
    used,
    remaining,
    isFirstCampaign: isFirst,
    firstCampaignLimit: C.FIRST_CAMPAIGN_LIMIT,
    firstCampaignRemaining,
    dailyCap: dailyCap || null,
    dailyCapRemaining,
    canSendNow
  }
}

/**
 * How many of `pending` recipients can be sent in this run: never more than the daily remaining budget,
 * the first-campaign remaining cap or the campaign's daily cap, and never below 0.
 */
function willSendNow(snapshot, pending) {
  let count = pending
  if (snapshot.remaining !== null) count = Math.min(count, snapshot.remaining)
  if (snapshot.firstCampaignRemaining !== null) count = Math.min(count, snapshot.firstCampaignRemaining)
  if (snapshot.dailyCapRemaining !== null) count = Math.min(count, snapshot.dailyCapRemaining)
  return Math.max(0, count)
}

module.exports = { getBudgetSnapshot, getDailyAllowance, isFirstCampaign, willSendNow, isSendWindowOpen, DEFAULT_DAILY_LIMIT }

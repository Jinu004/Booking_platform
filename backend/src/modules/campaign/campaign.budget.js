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
 * The ONE definition of the first-campaign cap (preview, confirm and sender all get it through getBudgetSnapshot below).
 * The cap is cumulative: a clinic's campaigns are capped until the clinic has sent FIRST_CAMPAIGN_LIMIT campaign messages in total.
 * "Sent" means a recipient with sent_at set, in any campaign and any status (failed unknown-state sends count too).
 *
 * For one campaign: the messages the clinic's OTHER campaigns sent decide whether this campaign is capped (fewer than the limit),
 * and this campaign may then put out at most limit - (others' sends) messages in total. Its own sends are not used to lift the cap,
 * so a campaign that started under the cap stays capped until it ends (never looser than the old "first campaign" rule).
 * @returns {Promise<{ capped: boolean, remaining: number|null }>} remaining is null when the campaign is not capped
 */
async function getFirstCampaignCap(tenantId, campaignId) {
  const res = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM campaign_recipients WHERE tenant_id = $1 AND campaign_id <> $2 AND sent_at IS NOT NULL) AS sent_other,
       (SELECT COUNT(*)::int FROM campaign_recipients WHERE tenant_id = $1 AND campaign_id = $2 AND sent_at IS NOT NULL) AS sent_this`,
    [tenantId, campaignId]
  )
  const { sent_other: sentOther, sent_this: sentThis } = res.rows[0]
  if (sentOther >= C.FIRST_CAMPAIGN_LIMIT) return { capped: false, remaining: null }
  return { capped: true, remaining: Math.max(0, C.FIRST_CAMPAIGN_LIMIT - sentOther - sentThis) }
}

/**
 * Messages still allowed under the cumulative cap for the whole clinic: the limit minus every campaign message it has sent
 * (all campaigns, sent_at set), never below 0. 0 means the cap no longer applies to new campaigns.
 */
async function getFirstCampaignRemaining(tenantId) {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS sent FROM campaign_recipients WHERE tenant_id = $1 AND sent_at IS NOT NULL`,
    [tenantId]
  )
  return Math.max(0, C.FIRST_CAMPAIGN_LIMIT - res.rows[0].sent)
}

/** True while this campaign is under the first-campaign cap (kept for callers that need a boolean) */
async function isFirstCampaign(tenantId, campaignId) {
  return (await getFirstCampaignCap(tenantId, campaignId)).capped
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

  // Cumulative first-campaign cap: capped until the clinic has sent FIRST_CAMPAIGN_LIMIT campaign messages in total
  const cap = await getFirstCampaignCap(tenantId, campaignId)
  const isFirst = cap.capped
  const clinicRemaining = await getFirstCampaignRemaining(tenantId)
  const firstRes = await pool.query(
    `SELECT (SELECT COUNT(*)::int FROM campaign_recipients WHERE campaign_id = $2 AND sent_at > now() - interval '24 hours') AS sent_24h,
            (SELECT daily_cap FROM campaigns WHERE id = $2 AND tenant_id = $1) AS daily_cap`,
    [tenantId, campaignId]
  )
  const { sent_24h: sent24h, daily_cap: dailyCap } = firstRes.rows[0]
  const firstCampaignRemaining = isFirst ? cap.remaining : null
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
    first_campaign_remaining: clinicRemaining, // the clinic-wide count under the cumulative cap (additive)
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

module.exports = { getBudgetSnapshot, getDailyAllowance, isFirstCampaign, getFirstCampaignRemaining, willSendNow, isSendWindowOpen, DEFAULT_DAILY_LIMIT }

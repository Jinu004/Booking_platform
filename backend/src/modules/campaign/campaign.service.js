const pool = require('../../config/database')
const logger = require('../../utils/logger')

// A patient who was sent a campaign message within this many days is skipped
const FREQUENCY_CAP_DAYS = 21
const MIN_DIGITS = 11
const MAX_DIGITS = 15
const ACTIVE_STATUSES = ['draft', 'running', 'paused']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

class CampaignError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'CampaignError'
    this.status = status
  }
}

const ASC_DIGITS = '01234567890123456789'
const DESC_DIGITS = '98765432109876543210'

/**
 * Mirror of the eligibility CASE in the recipient INSERT ... SELECT below (kept in step with it; tested without a database).
 * Only customers with marketing_consent 'all' become recipients; everyone else is counted, not inserted.
 * @returns {{ status: 'pending'|'skipped'|'excluded', skip_reason: string|null }}
 */
function classifyRecipient({ phone, marketingConsent, recentlySent = false, undeliverable = false }) {
  if (marketingConsent !== 'all') return { status: 'excluded', skip_reason: null }
  const digits = String(phone || '').replace(/\D/g, '')
  const tail = digits.slice(-10)
  const invalid =
    digits.length < MIN_DIGITS ||
    digits.length > MAX_DIGITS ||
    /^(\d)\1+$/.test(digits) ||
    /^(\d)\1{9}$/.test(tail) ||
    ASC_DIGITS.includes(digits) ||
    DESC_DIGITS.includes(digits) ||
    ASC_DIGITS.includes(tail) ||
    DESC_DIGITS.includes(tail)
  if (invalid) return { status: 'skipped', skip_reason: 'invalid_number' }
  if (recentlySent) return { status: 'skipped', skip_reason: 'recent_campaign' }
  if (undeliverable) return { status: 'skipped', skip_reason: 'undeliverable' }
  return { status: 'pending', skip_reason: null }
}

// The digits of a stored phone (stored as +<country code><number>)
const DIGITS_SQL = `regexp_replace(c.phone, '\\D', '', 'g')`

// Eligibility for every opted-in ('all') customer with a phone. $1 = tenant id, $2 = frequency cap in days.
// Order matters: invalid number, then recent campaign, then undeliverable (131026), else pending.
const ELIGIBILITY_SQL = `
  CASE
    WHEN length(${DIGITS_SQL}) < ${MIN_DIGITS}
      OR length(${DIGITS_SQL}) > ${MAX_DIGITS}
      OR ${DIGITS_SQL} ~ '^(\\d)\\1+$'
      OR right(${DIGITS_SQL}, 10) ~ '^(\\d)\\1{9}$'
      OR strpos('${ASC_DIGITS}', ${DIGITS_SQL}) > 0
      OR strpos('${DESC_DIGITS}', ${DIGITS_SQL}) > 0
      OR strpos('${ASC_DIGITS}', right(${DIGITS_SQL}, 10)) > 0
      OR strpos('${DESC_DIGITS}', right(${DIGITS_SQL}, 10)) > 0
      THEN 'invalid_number'
    WHEN EXISTS (
      SELECT 1 FROM campaign_recipients cr
      WHERE cr.tenant_id = c.tenant_id AND cr.customer_id = c.id
        AND cr.status = 'sent' AND cr.sent_at > now() - ($2::int * interval '1 day')
    ) THEN 'recent_campaign'
    WHEN EXISTS (
      SELECT 1 FROM campaign_recipients cr
      WHERE cr.tenant_id = c.tenant_id AND cr.customer_id = c.id AND cr.error_code = '131026'
    ) THEN 'undeliverable'
    ELSE NULL
  END`

const COUNTS_SELECT = `
  COUNT(*) FILTER (WHERE r.status = 'pending')::int AS pending,
  COUNT(*) FILTER (WHERE r.status = 'sent')::int AS sent,
  COUNT(*) FILTER (WHERE r.status = 'failed')::int AS failed,
  COUNT(*) FILTER (WHERE r.status = 'skipped')::int AS skipped`

function assertUuid(value, label) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new CampaignError(`${label} is invalid`, 400)
}

async function loadCounts(client, campaignId) {
  const res = await client.query(
    `SELECT r.status, r.skip_reason, COUNT(*)::int AS n FROM campaign_recipients r WHERE r.campaign_id = $1 GROUP BY r.status, r.skip_reason`,
    [campaignId]
  )
  const skipped = { invalid_number: 0, recent_campaign: 0, undeliverable: 0 }
  let pending = 0
  for (const row of res.rows) {
    if (row.status === 'pending') pending += row.n
    else if (row.status === 'skipped' && row.skip_reason in skipped) skipped[row.skip_reason] += row.n
  }
  return { pending, skipped }
}

/**
 * Creates a draft campaign and its recipient rows from the clinic's opted-in patients. Sends nothing.
 * Phone numbers are never copied into campaign_recipients.
 */
async function createDraftCampaign(tenantId, posterRequestId) {
  assertUuid(tenantId, 'Clinic id')
  if (!posterRequestId) throw new CampaignError('poster_request_id is required', 400)
  assertUuid(posterRequestId, 'poster_request_id')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Serialises campaign creation for this clinic so two requests cannot both pass the "no active campaign" check
    await client.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [tenantId])

    const posterRes = await client.query(
      'SELECT id, status, caption FROM poster_requests WHERE id = $1 AND tenant_id = $2',
      [posterRequestId, tenantId]
    )
    const poster = posterRes.rows[0]
    if (!poster) throw new CampaignError('Poster not found for this clinic', 400)
    if (poster.status !== 'approved') throw new CampaignError('The poster must be approved first', 409)

    const activeRes = await client.query(
      'SELECT 1 FROM campaigns WHERE tenant_id = $1 AND status = ANY($2) LIMIT 1',
      [tenantId, ACTIVE_STATUSES]
    )
    if (activeRes.rows.length) throw new CampaignError('Finish or cancel the current campaign first', 409)

    const campaignRes = await client.query(
      `INSERT INTO campaigns (tenant_id, poster_request_id, template_name, caption, status)
       VALUES ($1, $2, 'clinic_poster', $3, 'draft') RETURNING id`,
      [tenantId, poster.id, poster.caption]
    )
    const campaignId = campaignRes.rows[0].id

    await client.query(
      `INSERT INTO campaign_recipients (campaign_id, tenant_id, customer_id, status, skip_reason, consent_value)
       SELECT $3::uuid, c.tenant_id, c.id,
              CASE WHEN elig.reason IS NULL THEN 'pending' ELSE 'skipped' END,
              elig.reason,
              c.marketing_consent
       FROM customers c
       CROSS JOIN LATERAL (SELECT ${ELIGIBILITY_SQL} AS reason) elig
       WHERE c.tenant_id = $1
         AND c.phone IS NOT NULL AND c.phone <> ''
         AND c.marketing_consent = 'all'`,
      [tenantId, FREQUENCY_CAP_DAYS, campaignId]
    )

    const { pending, skipped } = await loadCounts(client, campaignId)
    const skippedTotal = skipped.invalid_number + skipped.recent_campaign + skipped.undeliverable

    const campaign = (await client.query(
      'UPDATE campaigns SET audience_count = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [campaignId, pending]
    )).rows[0]

    const otherRes = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE marketing_consent IS NULL)::int AS not_asked,
         COUNT(*) FILTER (WHERE marketing_consent IN ('none', 'checkups'))::int AS opted_out
       FROM customers WHERE tenant_id = $1 AND phone IS NOT NULL AND phone <> ''`,
      [tenantId]
    )

    await client.query('COMMIT')
    logger.info(`CAMPAIGN_DRAFT tenant=${tenantId} campaign=${campaignId} pending=${pending} skipped=${skippedTotal}`)
    return {
      campaign,
      counts: { pending, skipped, not_asked: otherRes.rows[0].not_asked, opted_out: otherRes.rows[0].opted_out }
    }
  } catch (err) {
    try { await client.query('ROLLBACK') } catch (_) { /* connection already gone */ }
    throw err
  } finally {
    client.release()
  }
}

const LIST_SQL = `
  SELECT cp.*, ${COUNTS_SELECT}
  FROM campaigns cp
  LEFT JOIN campaign_recipients r ON r.campaign_id = cp.id`

function shape(row) {
  const { pending, sent, failed, skipped, ...campaign } = row
  return { ...campaign, counts: { pending, sent, failed, skipped } }
}

async function getCampaigns(tenantId) {
  assertUuid(tenantId, 'Clinic id')
  const res = await pool.query(
    `${LIST_SQL} WHERE cp.tenant_id = $1 GROUP BY cp.id ORDER BY cp.created_at DESC`,
    [tenantId]
  )
  return res.rows.map(shape)
}

async function getCampaign(tenantId, campaignId) {
  assertUuid(tenantId, 'Clinic id')
  if (!UUID_RE.test(String(campaignId))) throw new CampaignError('Campaign not found', 404)
  const res = await pool.query(
    `${LIST_SQL} WHERE cp.tenant_id = $1 AND cp.id = $2 GROUP BY cp.id`,
    [tenantId, campaignId]
  )
  if (!res.rows[0]) throw new CampaignError('Campaign not found', 404)
  return shape(res.rows[0])
}

async function cancelCampaign(tenantId, campaignId) {
  assertUuid(tenantId, 'Clinic id')
  if (!UUID_RE.test(String(campaignId))) throw new CampaignError('Campaign not found', 404)
  // Single conditional update: only a draft or paused campaign of this clinic can be cancelled
  const res = await pool.query(
    `UPDATE campaigns SET status = 'cancelled', updated_at = now()
     WHERE id = $1 AND tenant_id = $2 AND status IN ('draft', 'paused') RETURNING id`,
    [campaignId, tenantId]
  )
  if (!res.rows[0]) {
    const exists = await pool.query('SELECT status FROM campaigns WHERE id = $1 AND tenant_id = $2', [campaignId, tenantId])
    if (!exists.rows[0]) throw new CampaignError('Campaign not found', 404)
    throw new CampaignError(`A ${exists.rows[0].status} campaign cannot be cancelled`, 409)
  }
  logger.info(`CAMPAIGN_CANCELLED tenant=${tenantId} campaign=${campaignId}`)
  return getCampaign(tenantId, campaignId)
}

module.exports = {
  FREQUENCY_CAP_DAYS,
  CampaignError,
  classifyRecipient,
  createDraftCampaign,
  getCampaigns,
  getCampaign,
  cancelCampaign,
  ELIGIBILITY_SQL
}

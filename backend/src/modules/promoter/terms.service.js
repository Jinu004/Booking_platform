/**
 * Referral terms: dated versions of the commission terms for one referred clinic.
 * A change never edits a row; it adds a row with a later effective_from. The accrual uses the
 * terms in force on the first day of the paid period.
 */
const { tierFor } = require('./scheme.service');
const { logPromoterAudit } = require('./promoter.audit');
const { isValidDateString, addMonths, monthStart, formatDate, parseDate } = require('../../utils/money');

class TermsError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Number of the promoter's referred clinics that paid for any day of the calendar month before `refDate`.
 * Used for tier thresholds.
 */
async function activePayingCount(db, promoterId, refDate) {
  const thisMonth = monthStart(refDate);
  const prevMonth = addMonths(thisMonth, -1);
  const prevMonthEnd = formatDate(parseDate(thisMonth) - 24 * 60 * 60 * 1000);
  const q = await db.query(`
    SELECT COUNT(DISTINCT r.id)::int AS n
    FROM tenant_referrals r
    JOIN subscription_payments p ON p.tenant_id = r.tenant_id
    WHERE r.promoter_id = $1 AND r.status = 'active' AND NOT r.no_commission
      AND p.status IN ('captured', 'partially_refunded') AND p.payment_type = 'subscription'
      AND p.period_start <= $3::date AND p.period_end >= $2::date`,
  [promoterId, prevMonth, prevMonthEnd]);
  return q.rows[0].n;
}

async function currentVersionOfScheme(db, schemeId) {
  const q = await db.query(`
    SELECT v.* FROM commission_schemes s JOIN commission_scheme_versions v ON v.id = s.current_version_id
    WHERE s.id = $1`, [schemeId]);
  if (!q.rows.length) throw new TermsError('Scheme not found', 404);
  return q.rows[0];
}

/** Terms in force for a date (latest effective_from <= date; the earliest row if the date is before all of them) */
async function termsFor(db, referralId, date) {
  const q = await db.query(`
    SELECT * FROM referral_terms WHERE referral_id = $1
    ORDER BY (effective_from <= $2::date) DESC,
             CASE WHEN effective_from <= $2::date THEN effective_from END DESC,
             effective_from ASC
    LIMIT 1`, [referralId, date]);
  return q.rows[0] || null;
}

async function latestTerms(db, referralId) {
  const q = await db.query(`SELECT * FROM referral_terms WHERE referral_id = $1 ORDER BY effective_from DESC LIMIT 1`, [referralId]);
  return q.rows[0] || null;
}

/**
 * Earliest date a new terms version may start: after the first day of every paid period that
 * already produced a commission, so existing commissions always stay consistent with their terms.
 */
async function minEffectiveFrom(db, referralId) {
  const q = await db.query(`
    SELECT (MAX(p.period_start) + 1)::text AS d
    FROM promoter_commissions c JOIN subscription_payments p ON p.id = c.payment_id
    WHERE c.referral_id = $1 AND c.entry_type = 'commission'`, [referralId]);
  return q.rows[0].d || null;
}

async function lockedTier(db, version, promoterId, refDate, previousIndex = null) {
  if (version.tier_mode !== 'locked' || !Array.isArray(version.tiers) || !version.tiers.length) {
    return { index: null, rate: null };
  }
  const idx = previousIndex != null
    ? Math.min(previousIndex, version.tiers.length - 1)
    : tierFor(version.tiers, await activePayingCount(db, promoterId, refDate));
  return { index: idx, rate: version.tiers[idx].rate_bps };
}

/** First terms row for a new referral, from the promoter's scheme and overrides */
async function createInitialTerms(client, { referral, promoter, effectiveFrom, reason }, actor) {
  const version = await currentVersionOfScheme(client, promoter.scheme_id);
  const months = promoter.override_months_set ? promoter.override_commission_months : version.commission_months;
  const tier = await lockedTier(client, version, promoter.id, effectiveFrom);
  const q = await client.query(`
    INSERT INTO referral_terms (referral_id, promoter_id, effective_from, scheme_version_id, override_rate_bps,
      months_overridden, commission_months, locked_tier_index, locked_tier_rate_bps, reason, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
  [referral.id, promoter.id, effectiveFrom, version.id, promoter.override_rate_bps,
    !!promoter.override_months_set, months, tier.index, tier.rate, reason,
    actor?.actorType === 'staff' ? actor.actorId : null]);
  return q.rows[0];
}

/**
 * Adds a terms version. Anything not given is carried over from `keepFrom` (default: latest terms).
 * @param {object} p
 * @param {string} p.referralId
 * @param {string} p.effectiveFrom YYYY-MM-DD
 * @param {object} [p.schemeVersion] new scheme version row (default: same as before)
 * @param {string} [p.promoterId] new promoter (reassignment)
 * @param {number|null} [p.overrideRate] undefined = keep, null = remove, number = set
 * @param {object} [p.months] { set: boolean, value: number|null }  undefined = keep
 */
async function addTermsVersion(client, { referralId, effectiveFrom, schemeVersion, promoterId, overrideRate, months, keepFrom, reason }, actor) {
  if (!isValidDateString(effectiveFrom)) throw new TermsError('Invalid effective date');
  if (!reason || !String(reason).trim()) throw new TermsError('A reason is required');
  const prev = keepFrom || await latestTerms(client, referralId);
  if (!prev) throw new TermsError('This referral has no terms yet', 404);

  const minDate = await minEffectiveFrom(client, referralId);
  if (minDate && effectiveFrom < minDate) {
    throw new TermsError(`Terms can only change from ${minDate} for this clinic: commission was already created for periods before that date.`);
  }
  const clash = await client.query(`SELECT 1 FROM referral_terms WHERE referral_id = $1 AND effective_from = $2`, [referralId, effectiveFrom]);
  if (clash.rows.length) throw new TermsError(`This clinic already has a terms change on ${effectiveFrom}. Pick another date.`, 409);

  const version = schemeVersion || (await client.query(`SELECT * FROM commission_scheme_versions WHERE id = $1`, [prev.scheme_version_id])).rows[0];
  const newPromoterId = promoterId || prev.promoter_id;

  let monthsOverridden = prev.months_overridden;
  let commissionMonths = prev.months_overridden ? prev.commission_months : version.commission_months;
  if (months !== undefined) {
    monthsOverridden = !!months.set;
    commissionMonths = months.set ? months.value : version.commission_months;
  }
  if (commissionMonths != null && !(Number.isInteger(commissionMonths) && commissionMonths >= 1 && commissionMonths <= 120)) {
    throw new TermsError('Months must be 1–120, or empty for lifetime');
  }
  const rate = overrideRate === undefined ? prev.override_rate_bps : overrideRate;
  if (rate != null && !(Number.isInteger(rate) && rate >= 0 && rate <= 5000)) throw new TermsError('Rate must be between 0% and 50%');

  const samePromoter = newPromoterId === prev.promoter_id;
  const tier = await lockedTier(client, version, newPromoterId, effectiveFrom, samePromoter ? prev.locked_tier_index : null);

  const q = await client.query(`
    INSERT INTO referral_terms (referral_id, promoter_id, effective_from, scheme_version_id, override_rate_bps,
      months_overridden, commission_months, locked_tier_index, locked_tier_rate_bps, reason, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
  [referralId, newPromoterId, effectiveFrom, version.id, rate, monthsOverridden, commissionMonths,
    tier.index, tier.rate, String(reason).trim(), actor?.actorType === 'staff' ? actor.actorId : null]);

  await logPromoterAudit(client, {
    ...actor, action: 'referral.terms_added', promoterId: newPromoterId, entityType: 'referral_terms', entityId: q.rows[0].id,
    before: { promoter_id: prev.promoter_id, scheme_version_id: prev.scheme_version_id, override_rate_bps: prev.override_rate_bps, commission_months: prev.commission_months },
    after: { promoter_id: newPromoterId, scheme_version_id: version.id, override_rate_bps: rate, commission_months: commissionMonths, effective_from: effectiveFrom },
    reason
  });
  return q.rows[0];
}

module.exports = {
  TermsError, activePayingCount, currentVersionOfScheme, termsFor, latestTerms, minEffectiveFrom,
  createInitialTerms, addTermsVersion
};

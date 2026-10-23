const pool = require('../../config/database');
const { logPromoterAudit } = require('./promoter.audit');
const { isValidDateString, todayIST } = require('../../utils/money');

class SchemeError extends Error {
  constructor(message, status = 400, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Index of the tier that applies for `activeCount`, or null when the scheme has no tiers */
function tierFor(tiers, activeCount) {
  if (!Array.isArray(tiers) || !tiers.length) return null;
  let idx = 0;
  for (let i = 0; i < tiers.length; i++) {
    if (activeCount >= tiers[i].min_active) idx = i;
  }
  return idx;
}

/**
 * Validates the editable values of a scheme version.
 * Returns { value, errors }.
 */
async function validateValues(input, db = pool) {
  const errors = {};
  const v = input || {};
  const intIn = (x, min, max) => Number.isInteger(x) && x >= min && x <= max;

  const value = {
    base_rate_bps: v.base_rate_bps,
    commission_months: v.commission_months === '' || v.commission_months === undefined ? null : v.commission_months,
    tier_mode: v.tier_mode || 'locked',
    plan_rates: v.plan_rates || {},
    tiers: v.tiers || [],
    first_payment_bonus_paise: v.first_payment_bonus_paise === '' || v.first_payment_bonus_paise === undefined ? null : v.first_payment_bonus_paise,
    monthly_cap_paise: v.monthly_cap_paise === '' || v.monthly_cap_paise === undefined ? null : v.monthly_cap_paise
  };

  if (!intIn(value.base_rate_bps, 0, 5000)) errors.base_rate_bps = 'Rate must be between 0% and 50%';
  if (value.commission_months !== null && !intIn(value.commission_months, 1, 120)) errors.commission_months = 'Months must be 1–120, or empty for lifetime';
  if (!['locked', 'live'].includes(value.tier_mode)) errors.tier_mode = 'Must be locked or live';

  if (typeof value.plan_rates !== 'object' || Array.isArray(value.plan_rates)) {
    errors.plan_rates = 'Must be an object of plan → rate';
  } else {
    const plans = await db.query('SELECT id FROM plans');
    const planIds = new Set(plans.rows.map(r => r.id));
    for (const [plan, rate] of Object.entries(value.plan_rates)) {
      if (!planIds.has(plan)) errors.plan_rates = `Unknown plan "${plan}"`;
      else if (!intIn(rate, 0, 5000)) errors.plan_rates = `Rate for ${plan} must be between 0% and 50%`;
    }
  }

  if (!Array.isArray(value.tiers)) {
    errors.tiers = 'Must be a list';
  } else if (value.tiers.length) {
    if (value.tiers.length > 10) errors.tiers = 'At most 10 tiers';
    let prev = -1;
    value.tiers.forEach((t, i) => {
      if (!t || !intIn(t.min_active, 0, 100000) || !intIn(t.rate_bps, 0, 5000)) {
        errors.tiers = `Tier ${i + 1}: clinics must be a whole number and rate 0–50%`;
      } else if (t.min_active <= prev) {
        errors.tiers = 'Tier thresholds must increase';
      } else {
        prev = t.min_active;
      }
    });
    if (!errors.tiers && value.tiers[0].min_active !== 0) errors.tiers = 'The first tier must start at 0 clinics';
    if (!errors.tiers) value.tiers = value.tiers.map(t => ({ min_active: t.min_active, rate_bps: t.rate_bps }));
  }

  if (value.first_payment_bonus_paise !== null && !intIn(value.first_payment_bonus_paise, 0, 100000000)) errors.first_payment_bonus_paise = 'Invalid bonus amount';
  if (value.monthly_cap_paise !== null && !intIn(value.monthly_cap_paise, 1, 100000000000)) errors.monthly_cap_paise = 'Invalid cap amount';

  return { value, errors };
}

async function listSchemes() {
  const q = await pool.query(`
    SELECT s.*, v.version, v.base_rate_bps, v.commission_months, v.tier_mode, v.plan_rates, v.tiers,
           v.first_payment_bonus_paise, v.monthly_cap_paise,
           (SELECT COUNT(*) FROM promoters p WHERE p.scheme_id = s.id AND p.status NOT IN ('rejected', 'terminated'))::int AS promoter_count
    FROM commission_schemes s
    JOIN commission_scheme_versions v ON v.id = s.current_version_id
    ORDER BY s.is_active DESC, s.name`);
  return q.rows;
}

async function getScheme(id) {
  const s = await pool.query(`SELECT * FROM commission_schemes WHERE id = $1`, [id]);
  if (!s.rows.length) throw new SchemeError('Scheme not found', 404);
  const versions = await pool.query(
    `SELECT v.*, st.name AS created_by_name FROM commission_scheme_versions v
     LEFT JOIN staff st ON st.id = v.created_by
     WHERE v.scheme_id = $1 ORDER BY v.version DESC`, [id]);
  const usage = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM promoters WHERE scheme_id = $1 AND status NOT IN ('rejected', 'terminated'))::int AS promoters,
      (SELECT COUNT(DISTINCT t.referral_id) FROM referral_terms t
         JOIN commission_scheme_versions v ON v.id = t.scheme_version_id
         WHERE v.scheme_id = $1)::int AS referrals`, [id]);
  return { ...s.rows[0], versions: versions.rows, usage: usage.rows[0] };
}

async function createScheme({ name, description, values, reason }, actor) {
  if (!name || !String(name).trim()) throw new SchemeError('Name is required');
  if (!reason || !String(reason).trim()) throw new SchemeError('A reason is required');
  const { value, errors } = await validateValues(values);
  if (Object.keys(errors).length) throw new SchemeError('Some values are invalid', 400, errors);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const s = await client.query(
      `INSERT INTO commission_schemes (name, description) VALUES ($1, $2) RETURNING *`,
      [String(name).trim().slice(0, 100), description || null]);
    const v = await insertVersion(client, s.rows[0].id, 1, value, reason, actor);
    await client.query(`UPDATE commission_schemes SET current_version_id = $1 WHERE id = $2`, [v.id, s.rows[0].id]);
    await logPromoterAudit(client, { ...actor, action: 'scheme.create', entityType: 'commission_scheme', entityId: s.rows[0].id, after: { name, ...value }, reason });
    await client.query('COMMIT');
    return getScheme(s.rows[0].id);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') throw new SchemeError('A scheme with this name already exists', 409);
    throw err;
  } finally {
    client.release();
  }
}

async function insertVersion(client, schemeId, version, value, reason, actor) {
  const q = await client.query(
    `INSERT INTO commission_scheme_versions
      (scheme_id, version, base_rate_bps, commission_months, tier_mode, plan_rates, tiers,
       first_payment_bonus_paise, monthly_cap_paise, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [schemeId, version, value.base_rate_bps, value.commission_months, value.tier_mode,
      JSON.stringify(value.plan_rates), JSON.stringify(value.tiers),
      value.first_payment_bonus_paise, value.monthly_cap_paise, String(reason).trim(),
      actor?.actorType === 'staff' ? actor.actorId : null]);
  return q.rows[0];
}

/** Referrals whose terms in force today use this scheme (excluding revoked referrals) */
async function referralsOnScheme(db, schemeId) {
  const q = await db.query(`
    SELECT DISTINCT ON (t.referral_id) t.*, r.status AS referral_status
    FROM referral_terms t
    JOIN tenant_referrals r ON r.id = t.referral_id
    WHERE r.status <> 'revoked'
    ORDER BY t.referral_id, t.effective_from DESC`);
  const versionIds = await db.query(`SELECT id FROM commission_scheme_versions WHERE scheme_id = $1`, [schemeId]);
  const ids = new Set(versionIds.rows.map(r => r.id));
  return q.rows.filter(t => ids.has(t.scheme_version_id));
}

/**
 * Saves a new version of a scheme.
 * applyTo 'new' (default): only referrals created from now on use it.
 * applyTo 'existing': also adds new dated terms (from effectiveFrom) for every referral currently on this scheme.
 */
async function saveVersion(schemeId, { values, reason, baseVersion, applyTo = 'new', effectiveFrom, name, description, isActive }, actor) {
  if (!reason || !String(reason).trim()) throw new SchemeError('A reason is required');
  if (!['new', 'existing'].includes(applyTo)) throw new SchemeError('applyTo must be new or existing');
  if (applyTo === 'existing' && !isValidDateString(effectiveFrom)) throw new SchemeError('Choose the date the change applies from');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const s = await client.query(`SELECT * FROM commission_schemes WHERE id = $1 FOR UPDATE`, [schemeId]);
    if (!s.rows.length) throw new SchemeError('Scheme not found', 404);
    const scheme = s.rows[0];
    const cur = await client.query(`SELECT * FROM commission_scheme_versions WHERE id = $1`, [scheme.current_version_id]);
    const current = cur.rows[0];
    if (Number(baseVersion) !== current.version) {
      throw new SchemeError(`This scheme was changed by someone else (now version ${current.version}). Reload and try again.`, 409);
    }

    // Header fields (name, description, active) do not need a new version
    if (name !== undefined || description !== undefined || isActive !== undefined) {
      if (isActive === false) {
        const def = await client.query(`SELECT settings->>'default_scheme_id' AS id FROM promoter_program_settings ORDER BY version DESC LIMIT 1`);
        if (def.rows[0]?.id === schemeId) throw new SchemeError('This is the default scheme in settings; choose another default first');
      }
      await client.query(
        `UPDATE commission_schemes SET name = COALESCE($1, name), description = COALESCE($2, description),
           is_active = COALESCE($3, is_active), updated_at = now() WHERE id = $4`,
        [name ? String(name).trim().slice(0, 100) : null, description ?? null, isActive ?? null, schemeId]);
    }

    let version = current;
    let affected = 0;
    if (values) {
      const { value, errors } = await validateValues(values, client);
      if (Object.keys(errors).length) throw new SchemeError('Some values are invalid', 400, errors);
      version = await insertVersion(client, schemeId, current.version + 1, value, reason, actor);
      await client.query(`UPDATE commission_schemes SET current_version_id = $1, updated_at = now() WHERE id = $2`, [version.id, schemeId]);

      if (applyTo === 'existing') {
        const termsService = require('./terms.service');
        const referrals = await referralsOnScheme(client, schemeId);
        for (const t of referrals) {
          await termsService.addTermsVersion(client, {
            referralId: t.referral_id,
            effectiveFrom,
            schemeVersion: version,
            keepFrom: t,
            reason: `Scheme "${scheme.name}" v${version.version}: ${String(reason).trim()}`
          }, actor);
          affected++;
        }
      }
    }

    await logPromoterAudit(client, {
      ...actor, action: 'scheme.update', entityType: 'commission_scheme', entityId: schemeId,
      before: values ? pickVersion(current) : null, after: values ? { ...pickVersion(version), apply_to: applyTo, effective_from: effectiveFrom || null, affected_referrals: affected } : { name, description, isActive },
      reason
    });
    await client.query('COMMIT');
    return { scheme: await getScheme(schemeId), affectedReferrals: affected };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') throw new SchemeError('A scheme with this name already exists', 409);
    throw err;
  } finally {
    client.release();
  }
}

function pickVersion(v) {
  return {
    version: v.version, base_rate_bps: v.base_rate_bps, commission_months: v.commission_months, tier_mode: v.tier_mode,
    plan_rates: v.plan_rates, tiers: v.tiers, first_payment_bonus_paise: v.first_payment_bonus_paise, monthly_cap_paise: v.monthly_cap_paise
  };
}

/**
 * Impact preview: how many promoters/referrals use the scheme and what a sample payment earns
 * under the current and the proposed values.
 */
async function previewVersion(schemeId, { values, applyTo = 'new' }) {
  const scheme = await getScheme(schemeId);
  const { value, errors } = await validateValues(values);
  const current = scheme.versions[0];
  const plans = await pool.query(`SELECT id, name, monthly_price_paise FROM plans WHERE is_active ORDER BY sort_order`);
  const rateFor = (v, planId, tierIdx) => {
    if (v.plan_rates && v.plan_rates[planId] != null) return v.plan_rates[planId];
    if (Array.isArray(v.tiers) && v.tiers.length) return v.tiers[Math.min(tierIdx, v.tiers.length - 1)].rate_bps;
    return v.base_rate_bps;
  };
  const samples = Object.keys(errors).length ? [] : plans.rows.map(p => ({
    plan: p.name,
    monthly_price_paise: Number(p.monthly_price_paise),
    current_paise: Math.floor(Number(p.monthly_price_paise) * rateFor(current, p.id, 0) / 10000),
    proposed_paise: Math.floor(Number(p.monthly_price_paise) * rateFor(value, p.id, 0) / 10000)
  }));
  const referrals = applyTo === 'existing' ? (await referralsOnScheme(pool, schemeId)).length : 0;
  return {
    errors,
    usage: scheme.usage,
    referralsAffected: referrals,
    samples,
    note: applyTo === 'existing'
      ? `${referrals} referred clinics will get new terms from the chosen date. Commissions already created are not changed.`
      : `Only clinics referred after saving will use these terms. ${scheme.usage.referrals} existing referrals keep their current terms.`
  };
}

function todayDefault() {
  return todayIST();
}

module.exports = { SchemeError, tierFor, validateValues, listSchemes, getScheme, createScheme, saveVersion, previewVersion, referralsOnScheme, todayDefault };

/**
 * Referral attribution: linking a clinic (tenant) to the promoter who brought it.
 * Attribution happens once, at signup (or by a super admin within the late-attribution window).
 */
const crypto = require('crypto');
const pool = require('../../config/database');
const settingsService = require('./settings.service');
const termsService = require('./terms.service');
const commission = require('./commission.service');
const { logPromoterAudit } = require('./promoter.audit');
const { emails } = require('./promoter.email');
const { normalizeCustomerPhone } = require('../../utils/phone');
const { todayIST, isValidDateString } = require('../../utils/money');
const { httpError } = require('../../utils/route');
const logger = require('../../utils/logger');

function cleanCode(code) {
  const c = String(code || '').trim().toUpperCase();
  return /^[A-Z0-9]{4,16}$/.test(c) ? c : null;
}

function fingerprints({ email, phone, whatsapp }) {
  const out = [];
  const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
  if (email) out.push(h('e:' + String(email).trim().toLowerCase()));
  for (const n of [phone, whatsapp]) {
    const p = normalizeCustomerPhone(n);
    if (p) out.push(h('p:' + p));
  }
  return [...new Set(out)];
}

/** Public check used by the sign-up form. Reveals only the promoter's first name. */
async function validateCode(code) {
  const settings = (await settingsService.getCurrent()).settings;
  const c = cleanCode(code);
  if (!settings.program_enabled || !c) return { valid: false };
  const q = await pool.query(`SELECT name FROM promoters WHERE code = $1 AND status = 'active'`, [c]);
  if (!q.rows.length) return { valid: false };
  return { valid: true, code: c, promoterName: String(q.rows[0].name).split(/\s+/)[0] };
}

/** Public settings the sign-up pages need */
async function publicConfig() {
  const s = (await settingsService.getCurrent()).settings;
  return {
    program_enabled: s.program_enabled,
    ref_memory_days: s.ref_memory_days,
    code_editable: s.code_editable,
    payout_methods: s.payout_methods,
    agreement_version: s.agreement_version,
    agreement_text: s.agreement_text
  };
}

async function selfReferral(db, promoter, owner) {
  const ownerEmail = String(owner.email || '').trim().toLowerCase();
  const phones = [owner.phone, owner.whatsapp].map(normalizeCustomerPhone).filter(Boolean);
  return (ownerEmail && promoter.email.toLowerCase() === ownerEmail) || phones.includes(promoter.phone);
}

async function returningClinic(db, tenantId, owner, fps) {
  const prior = await db.query(`
    SELECT 1 FROM tenant_referrals WHERE owner_fingerprints && $1::text[] AND tenant_id IS DISTINCT FROM $2 LIMIT 1`, [fps, tenantId]);
  if (prior.rows.length) return true;
  const wa = normalizeCustomerPhone(owner.whatsapp);
  const phone = normalizeCustomerPhone(owner.phone);
  const other = await db.query(`
    SELECT 1 FROM staff WHERE tenant_id <> $1 AND LOWER(email) = LOWER($2)
    UNION ALL SELECT 1 FROM tenants WHERE id <> $1 AND $3::text IS NOT NULL AND whatsapp_number = $3
    UNION ALL SELECT 1 FROM staff WHERE tenant_id <> $1 AND $4::text IS NOT NULL AND phone IN ($4, SUBSTRING($4 FROM 4))
    LIMIT 1`, [tenantId, String(owner.email || ''), wa, phone]);
  return other.rows.length > 0;
}

/**
 * Creates the referral for a clinic that just signed up. Runs inside the sign-up transaction.
 * Never throws for a bad code (sign-up must not fail because of it); returns { referral, notify } or null.
 * @param {object} p
 * @param {object} p.tenant  the new tenant row
 * @param {object} p.owner   { email, phone, whatsapp }
 * @param {string} p.code
 * @param {'signup_link'|'signup_manual_code'} p.source
 */
async function attachAtSignup(client, { tenant, owner, code, source }, ip) {
  const c = cleanCode(code);
  if (!c) return null;
  const settings = (await settingsService.getCurrent(client)).settings;
  if (!settings.program_enabled) return null;
  const pq = await client.query(`SELECT * FROM promoters WHERE code = $1 AND status = 'active'`, [c]);
  const promoter = pq.rows[0];
  if (!promoter) {
    logger.info(`Signup with unknown or inactive referral code ignored (tenant ${tenant.id})`);
    return null;
  }

  let status = 'active';
  let flagReason = null;
  let noCommission = false;
  if (await selfReferral(client, promoter, owner)) {
    if (settings.self_referral_policy === 'block') {
      await logPromoterAudit(client, { actorType: 'public', action: 'referral.blocked_self_referral', promoterId: promoter.id, tenantId: tenant.id, ip });
      return null;
    }
    if (settings.self_referral_policy === 'flag') { status = 'flagged'; flagReason = 'Self-referral: promoter details match the clinic owner'; }
  }
  const fps = fingerprints(owner);
  if (status === 'active' && settings.returning_clinic_policy !== 'allow' && await returningClinic(client, tenant.id, owner, fps)) {
    if (settings.returning_clinic_policy === 'flag') { status = 'flagged'; flagReason = 'Returning clinic: owner details were used by another clinic before'; }
    else { noCommission = true; flagReason = 'Returning clinic: attributed without commission'; }
  }

  const today = todayIST();
  const ins = await client.query(`
    INSERT INTO tenant_referrals (tenant_id, tenant_name, promoter_id, source, window_start, status, flag_reason, no_commission, owner_fingerprints)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
  [tenant.id, tenant.name, promoter.id, source === 'signup_link' ? 'signup_link' : 'signup_manual_code',
    settings.commission_starts_at === 'attribution' ? today : null, status, flagReason, noCommission, fps]);
  const referral = ins.rows[0];
  await termsService.createInitialTerms(client, { referral, promoter, effectiveFrom: today, reason: 'Referral at sign-up' }, { actorType: 'public' });
  await logPromoterAudit(client, {
    actorType: 'public', action: 'referral.created', promoterId: promoter.id, tenantId: tenant.id,
    entityType: 'tenant_referral', entityId: referral.id, after: { source: referral.source, status, flag_reason: flagReason, no_commission: noCommission }, ip
  });
  return { referral, notify: settings.email_on_new_clinic ? () => emails.newClinic(promoter, tenant.name) : null };
}

async function ownerOfTenant(db, tenantId) {
  const q = await db.query(`
    SELECT s.email, s.phone, t.whatsapp_number FROM tenants t
    LEFT JOIN LATERAL (SELECT email, phone FROM staff WHERE tenant_id = t.id AND role = 'admin' ORDER BY created_at LIMIT 1) s ON true
    WHERE t.id = $1`, [tenantId]);
  const r = q.rows[0] || {};
  return { email: r.email, phone: r.phone, whatsapp: r.whatsapp_number };
}

/**
 * Super admin attaches a promoter to a clinic that has none (late attribution),
 * or reassigns a clinic to another promoter (future payments only).
 */
async function adminAssign(tenantId, { promoter_id, reason, effective_from }, actor) {
  if (!reason || !String(reason).trim()) throw httpError('A reason is required', 400);
  const settings = (await settingsService.getCurrent()).settings;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tq = await client.query(`SELECT * FROM tenants WHERE id = $1`, [tenantId]);
    const tenant = tq.rows[0];
    if (!tenant) throw httpError('Clinic not found', 404);
    const pq = await client.query(`SELECT * FROM promoters WHERE id = $1`, [promoter_id]);
    const promoter = pq.rows[0];
    if (!promoter) throw httpError('Promoter not found', 404);
    if (promoter.status !== 'active') throw httpError('Only active promoters can be assigned', 400);
    const existing = await client.query(`SELECT * FROM tenant_referrals WHERE tenant_id = $1 FOR UPDATE`, [tenantId]);
    const today = todayIST();
    let referral;

    if (!existing.rows.length) {
      const deadline = new Date(new Date(tenant.created_at).getTime() + settings.late_attribution_days * 86400000);
      if (settings.late_attribution_days === 0 || deadline < new Date()) {
        throw httpError(`Late attribution is only allowed within ${settings.late_attribution_days} days of sign-up (see program settings)`, 400);
      }
      const owner = await ownerOfTenant(client, tenantId);
      const ins = await client.query(`
        INSERT INTO tenant_referrals (tenant_id, tenant_name, promoter_id, source, window_start, owner_fingerprints, created_by)
        VALUES ($1, $2, $3, 'admin_assigned', $4, $5, $6) RETURNING *`,
      [tenantId, tenant.name, promoter.id, settings.commission_starts_at === 'attribution' ? today : null,
        fingerprints(owner), actor.actorId]);
      referral = ins.rows[0];
      await termsService.createInitialTerms(client, { referral, promoter, effectiveFrom: today, reason: String(reason).trim() }, actor);
      await logPromoterAudit(client, { ...actor, action: 'referral.assigned', promoterId: promoter.id, tenantId, entityType: 'tenant_referral', entityId: referral.id, reason });
    } else {
      referral = existing.rows[0];
      if (referral.promoter_id === promoter.id) throw httpError('This clinic is already assigned to this promoter', 400);
      if (!settings.reassignment_allowed) throw httpError('Reassignment is turned off in program settings', 400);
      const eff = effective_from || today;
      if (!isValidDateString(eff)) throw httpError('Invalid effective date', 400);
      const version = await termsService.currentVersionOfScheme(client, promoter.scheme_id);
      await termsService.addTermsVersion(client, {
        referralId: referral.id, effectiveFrom: eff, schemeVersion: version, promoterId: promoter.id,
        overrideRate: promoter.override_rate_bps,
        months: { set: promoter.override_months_set, value: promoter.override_commission_months },
        reason: `Reassigned: ${String(reason).trim()}`
      }, actor);
      const before = referral.promoter_id;
      const up = await client.query(`UPDATE tenant_referrals SET promoter_id = $2, updated_at = now() WHERE id = $1 RETURNING *`, [referral.id, promoter.id]);
      referral = up.rows[0];
      await logPromoterAudit(client, { ...actor, action: 'referral.reassigned', promoterId: promoter.id, tenantId, entityType: 'tenant_referral', entityId: referral.id, before: { promoter_id: before }, after: { promoter_id: promoter.id, effective_from: eff }, reason });
    }
    await client.query('COMMIT');
    return getForTenant(tenantId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Status changes on a referral: clear a flag, mark no-commission, revoke (voids unpaid commission).
 */
async function setStatus(tenantId, { action, reason }, actor) {
  if (!reason || !String(reason).trim()) throw httpError('A reason is required', 400);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = await client.query(`SELECT * FROM tenant_referrals WHERE tenant_id = $1 FOR UPDATE`, [tenantId]);
    const r = q.rows[0];
    if (!r) throw httpError('This clinic has no referral', 404);
    let voided = 0;
    if (action === 'clear_flag') {
      if (r.status !== 'flagged') throw httpError('This referral is not flagged', 400);
      await client.query(`UPDATE tenant_referrals SET status = 'active', flag_reason = NULL, updated_at = now() WHERE id = $1`, [r.id]);
    } else if (action === 'flag') {
      if (r.status !== 'active') throw httpError('Only active referrals can be flagged', 400);
      await client.query(`UPDATE tenant_referrals SET status = 'flagged', flag_reason = $2, updated_at = now() WHERE id = $1`, [r.id, String(reason).trim()]);
    } else if (action === 'no_commission' || action === 'allow_commission') {
      await client.query(`UPDATE tenant_referrals SET no_commission = $2, updated_at = now() WHERE id = $1`, [r.id, action === 'no_commission']);
    } else if (action === 'revoke') {
      if (r.status === 'revoked') throw httpError('Already revoked', 400);
      await client.query(`UPDATE tenant_referrals SET status = 'revoked', flag_reason = $2, updated_at = now() WHERE id = $1`, [r.id, String(reason).trim()]);
      voided = await commission.voidUnpaidForReferral(client, r.id, `Referral revoked: ${String(reason).trim()}`);
    } else {
      throw httpError('Unknown action', 400);
    }
    await logPromoterAudit(client, {
      ...actor, action: `referral.${action}`, promoterId: r.promoter_id, tenantId, entityType: 'tenant_referral', entityId: r.id,
      before: { status: r.status, no_commission: r.no_commission }, after: { voided_entries: voided }, reason
    });
    await client.query('COMMIT');
    return getForTenant(tenantId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Adds a dated terms version for one clinic (rate / months override or another scheme version) */
async function changeTerms(tenantId, { effective_from, override_rate_bps, months_set, commission_months, scheme_id, reason }, actor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = await client.query(`SELECT * FROM tenant_referrals WHERE tenant_id = $1 FOR UPDATE`, [tenantId]);
    const r = q.rows[0];
    if (!r) throw httpError('This clinic has no referral', 404);
    if (r.status === 'revoked') throw httpError('This referral is revoked', 400);
    const version = scheme_id ? await termsService.currentVersionOfScheme(client, scheme_id) : undefined;
    await termsService.addTermsVersion(client, {
      referralId: r.id, effectiveFrom: effective_from, schemeVersion: version,
      overrideRate: override_rate_bps === undefined ? undefined : override_rate_bps,
      months: months_set === undefined ? undefined : { set: !!months_set, value: commission_months ?? null },
      reason
    }, actor);
    await client.query('COMMIT');
    return getForTenant(tenantId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err instanceof termsService.TermsError) throw httpError(err.message, err.status);
    throw err;
  } finally {
    client.release();
  }
}

async function getForTenant(tenantId) {
  const q = await pool.query(`
    SELECT r.id, r.tenant_id, r.tenant_name, r.promoter_id, r.source, r.window_start::text AS window_start, r.status,
      r.flag_reason, r.no_commission, r.attributed_at, p.name AS promoter_name, p.code AS promoter_code, p.status AS promoter_status
    FROM tenant_referrals r JOIN promoters p ON p.id = r.promoter_id WHERE r.tenant_id = $1`, [tenantId]);
  const settings = (await settingsService.getCurrent()).settings;
  const tq = await pool.query(`SELECT created_at FROM tenants WHERE id = $1`, [tenantId]);
  const lateDeadline = tq.rows[0]
    ? new Date(new Date(tq.rows[0].created_at).getTime() + settings.late_attribution_days * 86400000)
    : null;
  if (!q.rows.length) {
    return { referral: null, terms: [], totals: null, canAssign: !!lateDeadline && settings.late_attribution_days > 0 && lateDeadline > new Date(), lateDeadline, reassignmentAllowed: settings.reassignment_allowed };
  }
  const r = q.rows[0];
  const terms = await pool.query(`
    SELECT t.*, t.effective_from::text AS effective_from, v.version AS scheme_version, v.base_rate_bps, v.commission_months AS scheme_months,
      v.tier_mode, v.plan_rates, v.tiers, s.name AS scheme_name, s.id AS scheme_id, p.name AS promoter_name, st.name AS created_by_name
    FROM referral_terms t
    JOIN commission_scheme_versions v ON v.id = t.scheme_version_id
    JOIN commission_schemes s ON s.id = v.scheme_id
    JOIN promoters p ON p.id = t.promoter_id
    LEFT JOIN staff st ON st.id = t.created_by
    WHERE t.referral_id = $1 ORDER BY t.effective_from DESC`, [r.id]);
  const totals = await pool.query(`
    SELECT
      COALESCE(SUM(amount_paise) FILTER (WHERE status = 'pending'), 0)::bigint AS pending_paise,
      COALESCE(SUM(amount_paise) FILTER (WHERE status = 'available'), 0)::bigint AS available_paise,
      COALESCE(SUM(amount_paise) FILTER (WHERE status = 'paid'), 0)::bigint AS paid_paise
    FROM promoter_commissions WHERE referral_id = $1`, [r.id]);
  const minDate = await termsService.minEffectiveFrom(pool, r.id);
  const t = totals.rows[0];
  return {
    referral: r,
    terms: terms.rows,
    totals: { pending_paise: Number(t.pending_paise), available_paise: Number(t.available_paise), paid_paise: Number(t.paid_paise) },
    minTermsDate: minDate,
    canAssign: false,
    reassignmentAllowed: settings.reassignment_allowed
  };
}

module.exports = { cleanCode, fingerprints, validateCode, publicConfig, attachAtSignup, adminAssign, setStatus, changeTerms, getForTenant };

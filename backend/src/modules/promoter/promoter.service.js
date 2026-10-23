/**
 * Promoters: applications, approval, status changes, admin overrides, payout details, agreement.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../../config/database');
const settingsService = require('./settings.service');
const termsService = require('./terms.service');
const commission = require('./commission.service');
const { logPromoterAudit } = require('./promoter.audit');
const { emails } = require('./promoter.email');
const { normalizeCustomerPhone } = require('../../utils/phone');
const { encrypt } = require('../../utils/secretBox');
const { isValidDateString, todayIST } = require('../../utils/money');
const { httpError } = require('../../utils/route');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const ACCOUNT_RE = /^[0-9]{9,18}$/;

// Columns safe to return to the promoter themselves or to admins (no hashes, no encrypted bank number)
const PUBLIC_COLUMNS = `id, code, name, email, phone, city, status, status_reason, scheme_id, override_rate_bps,
  override_months_set, override_commission_months, override_min_payout_paise, pan, gstin, payout_method, upi_id,
  bank_account_last4, bank_ifsc, bank_holder_name, kyc_status, kyc_note, agreement_version, agreement_accepted_at,
  approved_at, last_login, created_at, updated_at`;

function maskPan(pan) {
  return pan ? `${pan.slice(0, 5)}****${pan.slice(-1)}` : null;
}

/** View of a promoter for the partner portal */
function selfView(p) {
  return { ...p, pan: maskPan(p.pan) };
}

async function generateCode(db, settings) {
  const prefix = settings.code_prefix || '';
  for (let attempt = 0; attempt < 20; attempt++) {
    let body = '';
    const bytes = crypto.randomBytes(settings.code_length);
    for (let i = 0; i < settings.code_length; i++) body += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    const code = (prefix + body).slice(0, 16);
    const exists = await db.query('SELECT 1 FROM promoters WHERE code = $1', [code]);
    if (!exists.rows.length) return code;
  }
  throw new Error('Could not generate a unique referral code');
}

function validateIdentity({ name, email, phone, city }) {
  const errors = {};
  if (!name || String(name).trim().length < 2 || String(name).length > 255) errors.name = 'Enter your full name';
  if (!email || !EMAIL_RE.test(String(email).trim()) || String(email).length > 255) errors.email = 'Enter a valid email';
  const normalizedPhone = normalizeCustomerPhone(phone);
  if (!normalizedPhone) errors.phone = 'Enter a valid mobile number';
  if (city && String(city).length > 100) errors.city = 'Too long';
  return { errors, value: { name: String(name || '').trim(), email: String(email || '').trim().toLowerCase(), phone: normalizedPhone, city: city ? String(city).trim() : null } };
}

async function isClinicUser(db, email, phone) {
  const q = await db.query(`
    SELECT 1 FROM staff WHERE LOWER(email) = $1 OR ($2::text IS NOT NULL AND phone IN ($2, SUBSTRING($2 FROM 4)))
    UNION ALL SELECT 1 FROM tenants WHERE $2::text IS NOT NULL AND whatsapp_number = $2
    LIMIT 1`, [email, phone]);
  return q.rows.length > 0;
}

/** Public application from /partner/apply */
async function apply(input, { ip } = {}) {
  const settings = (await settingsService.getCurrent()).settings;
  if (!settings.program_enabled) throw httpError('The partner program is not open right now', 403);
  const { errors, value } = validateIdentity(input || {});
  if (!input?.password || String(input.password).length < 8) errors.password = 'Password must be at least 8 characters';
  if (input?.agreement_accepted !== true) errors.agreement_accepted = 'Please accept the partner agreement';
  if (Object.keys(errors).length) throw httpError('Some fields are invalid', 400, errors);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!settings.allow_tenant_promoters && await isClinicUser(client, value.email, value.phone)) {
      throw httpError('This email or phone belongs to a clinic account. Please apply with your personal details.', 400);
    }
    const code = await generateCode(client, settings);
    const passwordHash = await bcrypt.hash(String(input.password), 12);
    const auto = settings.approval_mode === 'auto';
    const ins = await client.query(`
      INSERT INTO promoters (code, name, email, phone, city, password_hash, status, scheme_id,
        agreement_version, agreement_accepted_at, approved_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10)
      RETURNING ${PUBLIC_COLUMNS}`,
    [code, value.name, value.email, value.phone, value.city, passwordHash, auto ? 'active' : 'pending',
      settings.default_scheme_id, settings.agreement_version, auto ? new Date() : null]);
    const promoter = ins.rows[0];
    await logPromoterAudit(client, {
      actorType: 'public', action: auto ? 'promoter.applied_auto_approved' : 'promoter.applied',
      promoterId: promoter.id, entityType: 'promoter', entityId: promoter.id, after: { email: value.email, status: promoter.status }, ip
    });
    await client.query('COMMIT');
    if (auto && settings.email_on_approval) emails.approved(promoter);
    else emails.applicationReceived(promoter);
    return { status: promoter.status };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      // Same answer for duplicate email or phone, without saying which exists
      throw httpError('An application with this email or phone already exists. Try signing in or resetting your password.', 409);
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Super admin creates an active promoter directly; they get an email to set their password */
async function adminCreate(input, actor) {
  const settings = (await settingsService.getCurrent()).settings;
  const { errors, value } = validateIdentity(input || {});
  const schemeId = input?.scheme_id || settings.default_scheme_id;
  if (Object.keys(errors).length) throw httpError('Some fields are invalid', 400, errors);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertActiveScheme(client, schemeId);
    const code = await generateCode(client, settings);
    const ins = await client.query(`
      INSERT INTO promoters (code, name, email, phone, city, status, scheme_id, approved_by, approved_at)
      VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, now()) RETURNING ${PUBLIC_COLUMNS}`,
    [code, value.name, value.email, value.phone, value.city, schemeId, actor.actorId]);
    const promoter = ins.rows[0];
    const token = await createResetToken(client, promoter.id, 48);
    await logPromoterAudit(client, { ...actor, action: 'promoter.created', promoterId: promoter.id, entityType: 'promoter', entityId: promoter.id, after: { email: value.email, scheme_id: schemeId } });
    await client.query('COMMIT');
    emails.setPassword(promoter, token);
    return promoter;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') throw httpError('A promoter with this email or phone already exists', 409);
    throw err;
  } finally {
    client.release();
  }
}

async function assertActiveScheme(db, schemeId) {
  const s = await db.query('SELECT is_active FROM commission_schemes WHERE id = $1', [schemeId]);
  if (!s.rows.length) throw httpError('Scheme not found', 404);
  if (!s.rows[0].is_active) throw httpError('This scheme is inactive', 400);
}

async function createResetToken(db, promoterId, hours) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.query(`UPDATE promoter_password_resets SET used_at = now() WHERE promoter_id = $1 AND used_at IS NULL`, [promoterId]);
  await db.query(
    `INSERT INTO promoter_password_resets (promoter_id, token_hash, expires_at) VALUES ($1, $2, now() + ($3 || ' hours')::interval)`,
    [promoterId, crypto.createHash('sha256').update(token).digest('hex'), String(hours)]);
  return token;
}

async function getForUpdate(client, id) {
  const q = await client.query(`SELECT * FROM promoters WHERE id = $1 FOR UPDATE`, [id]);
  if (!q.rows.length) throw httpError('Promoter not found', 404);
  return q.rows[0];
}

/**
 * Status changes by a super admin: approve, reject, suspend, reactivate, terminate.
 */
async function changeStatus(id, action, { reason, scheme_id } = {}, actor) {
  const transitions = {
    approve: { from: ['pending'], to: 'active' },
    reject: { from: ['pending'], to: 'rejected' },
    suspend: { from: ['active'], to: 'suspended' },
    reactivate: { from: ['suspended'], to: 'active' },
    terminate: { from: ['active', 'suspended'], to: 'terminated' }
  };
  const t = transitions[action];
  if (!t) throw httpError('Unknown action', 400);
  if (action !== 'approve' && (!reason || !String(reason).trim())) throw httpError('A reason is required', 400);

  const settings = (await settingsService.getCurrent()).settings;
  const client = await pool.connect();
  let promoter;
  let voided = 0;
  try {
    await client.query('BEGIN');
    const before = await getForUpdate(client, id);
    if (!t.from.includes(before.status)) throw httpError(`Cannot ${action} a ${before.status} promoter`, 400);
    if (scheme_id) await assertActiveScheme(client, scheme_id);
    const up = await client.query(`
      UPDATE promoters SET status = $2::varchar, status_reason = $3, updated_at = now(),
        scheme_id = COALESCE($4::uuid, scheme_id),
        approved_by = CASE WHEN $2::varchar = 'active' AND approved_at IS NULL THEN $5::uuid ELSE approved_by END,
        approved_at = CASE WHEN $2::varchar = 'active' AND approved_at IS NULL THEN now() ELSE approved_at END
      WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
    [id, t.to, reason ? String(reason).trim() : null, scheme_id || null, actor.actorId]);
    promoter = up.rows[0];

    if (['suspended', 'terminated', 'rejected'].includes(t.to)) {
      await client.query(`DELETE FROM promoter_sessions WHERE promoter_id = $1`, [id]);
    }
    if (t.to === 'terminated' && settings.terminated_promoter_policy === 'forfeit') {
      // Same lock as a payout run, so a run cannot create a draft for this promoter in between
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('promoter_payout_run'))`);
      const open = await client.query(
        `SELECT id FROM promoter_payouts WHERE promoter_id = $1 AND status IN ('draft', 'approved') FOR UPDATE`, [id]);
      const openIds = open.rows.map(r => r.id);
      if (openIds.length) {
        await client.query(`UPDATE promoter_commissions SET payout_id = NULL WHERE payout_id = ANY($1) AND status = 'available'`, [openIds]);
        await client.query(`
          UPDATE promoter_payouts SET status = 'cancelled', notes = CONCAT_WS(E'\\n', notes, 'Cancelled: promoter terminated'), updated_at = now()
          WHERE id = ANY($1)`, [openIds]);
      }
      voided = await commission.voidUnpaidForPromoter(client, id, 'Forfeited: promoter terminated');
    }
    await logPromoterAudit(client, {
      ...actor, action: `promoter.${action}`, promoterId: id, entityType: 'promoter', entityId: id,
      before: { status: before.status }, after: { status: t.to, scheme_id: promoter.scheme_id, forfeited_entries: voided }, reason
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (action === 'approve' && settings.email_on_approval) emails.approved(promoter);
  else if (action !== 'approve') emails.statusChanged(promoter, promoter.status, reason);
  return { promoter, forfeitedEntries: voided };
}

/**
 * Admin changes to commercial terms: scheme, rate/months overrides, minimum payout.
 * applyTo 'new' = only clinics referred from now on. 'existing' = also add dated terms to every
 * current referral of this promoter from effectiveFrom.
 */
async function updateTerms(id, body, actor) {
  const { scheme_id, override_rate_bps, override_months_set, override_commission_months, override_min_payout_paise, reason, applyTo = 'new', effectiveFrom } = body || {};
  if (!reason || !String(reason).trim()) throw httpError('A reason is required', 400);
  if (!['new', 'existing'].includes(applyTo)) throw httpError('applyTo must be new or existing', 400);
  if (applyTo === 'existing' && !isValidDateString(effectiveFrom)) throw httpError('Choose the date the change applies from', 400);
  const errors = {};
  if (override_rate_bps != null && !(Number.isInteger(override_rate_bps) && override_rate_bps >= 0 && override_rate_bps <= 5000)) errors.override_rate_bps = 'Rate must be between 0% and 50%';
  if (override_months_set && override_commission_months != null && !(Number.isInteger(override_commission_months) && override_commission_months >= 1 && override_commission_months <= 120)) errors.override_commission_months = 'Months must be 1–120, or empty for lifetime';
  if (override_min_payout_paise != null && !(Number.isInteger(override_min_payout_paise) && override_min_payout_paise >= 0)) errors.override_min_payout_paise = 'Invalid amount';
  if (Object.keys(errors).length) throw httpError('Some fields are invalid', 400, errors);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await getForUpdate(client, id);
    const schemeId = scheme_id || before.scheme_id;
    if (scheme_id && scheme_id !== before.scheme_id) await assertActiveScheme(client, scheme_id);
    const monthsSet = override_months_set === undefined ? before.override_months_set : !!override_months_set;
    const up = await client.query(`
      UPDATE promoters SET scheme_id = $2, override_rate_bps = $3, override_months_set = $4,
        override_commission_months = $5, override_min_payout_paise = $6, updated_at = now()
      WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
    [id, schemeId,
      override_rate_bps === undefined ? before.override_rate_bps : override_rate_bps,
      monthsSet,
      monthsSet ? (override_commission_months === undefined ? before.override_commission_months : override_commission_months) : null,
      override_min_payout_paise === undefined ? before.override_min_payout_paise : override_min_payout_paise]);
    const promoter = up.rows[0];

    let affected = 0;
    if (applyTo === 'existing') {
      const version = await termsService.currentVersionOfScheme(client, promoter.scheme_id);
      const refs = await client.query(`SELECT id FROM tenant_referrals WHERE promoter_id = $1 AND status <> 'revoked'`, [id]);
      for (const r of refs.rows) {
        await termsService.addTermsVersion(client, {
          referralId: r.id, effectiveFrom, schemeVersion: version,
          overrideRate: promoter.override_rate_bps,
          months: { set: promoter.override_months_set, value: promoter.override_commission_months },
          reason: `Promoter terms changed: ${String(reason).trim()}`
        }, actor);
        affected++;
      }
    }
    await logPromoterAudit(client, {
      ...actor, action: 'promoter.terms_updated', promoterId: id, entityType: 'promoter', entityId: id,
      before: pickTerms(before), after: { ...pickTerms(promoter), apply_to: applyTo, effective_from: effectiveFrom || null, affected_referrals: affected }, reason
    });
    await client.query('COMMIT');
    return { promoter, affectedReferrals: affected };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function pickTerms(p) {
  return {
    scheme_id: p.scheme_id, override_rate_bps: p.override_rate_bps, override_months_set: p.override_months_set,
    override_commission_months: p.override_commission_months, override_min_payout_paise: p.override_min_payout_paise
  };
}

async function reviewKyc(id, { decision, note }, actor) {
  if (!['verified', 'rejected'].includes(decision)) throw httpError('decision must be verified or rejected', 400);
  if (decision === 'rejected' && !String(note || '').trim()) throw httpError('Add a note so the promoter knows what to fix', 400);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await getForUpdate(client, id);
    if (decision === 'verified' && (!before.payout_method || (!before.pan))) {
      throw httpError('PAN and payout details must be filled in before verifying', 400);
    }
    const up = await client.query(
      `UPDATE promoters SET kyc_status = $2, kyc_note = $3, updated_at = now() WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
      [id, decision, note ? String(note).trim() : null]);
    await logPromoterAudit(client, { ...actor, action: `promoter.kyc_${decision}`, promoterId: id, entityType: 'promoter', entityId: id, before: { kyc_status: before.kyc_status }, after: { kyc_status: decision }, reason: note });
    await client.query('COMMIT');
    return up.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Promoter updates their own payout and tax details. Any change sends KYC back to review. */
async function updatePayoutDetails(promoterId, body, { ip } = {}) {
  const settings = (await settingsService.getCurrent()).settings;
  const b = body || {};
  const errors = {};
  const pan = b.pan ? String(b.pan).trim().toUpperCase() : null;
  const gstin = b.gstin ? String(b.gstin).trim().toUpperCase() : null;
  if (!pan || !PAN_RE.test(pan)) errors.pan = 'Enter a valid PAN (e.g. ABCDE1234F)';
  if (gstin && !GSTIN_RE.test(gstin)) errors.gstin = 'Enter a valid GSTIN';
  if (!settings.payout_methods.includes(b.payout_method)) errors.payout_method = 'Choose a payout method';
  let upi = null; let account = null; let ifsc = null; let holder = null;
  if (b.payout_method === 'upi') {
    upi = String(b.upi_id || '').trim();
    if (!UPI_RE.test(upi)) errors.upi_id = 'Enter a valid UPI ID (e.g. name@bank)';
  } else if (b.payout_method === 'bank') {
    account = String(b.bank_account || '').replace(/\s/g, '');
    ifsc = String(b.bank_ifsc || '').trim().toUpperCase();
    holder = String(b.bank_holder_name || '').trim();
    if (!ACCOUNT_RE.test(account)) errors.bank_account = 'Enter a valid account number';
    if (!IFSC_RE.test(ifsc)) errors.bank_ifsc = 'Enter a valid IFSC';
    if (holder.length < 2 || holder.length > 255) errors.bank_holder_name = 'Enter the account holder name';
  }
  if (Object.keys(errors).length) throw httpError('Some fields are invalid', 400, errors);

  const enc = account ? encrypt(account) : null;
  const up = await pool.query(`
    UPDATE promoters SET pan = $2, gstin = $3, payout_method = $4, upi_id = $5,
      bank_account_enc = $6, bank_account_last4 = $7, bank_ifsc = $8, bank_holder_name = $9,
      kyc_status = 'submitted', kyc_note = NULL, updated_at = now()
    WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
  [promoterId, pan, gstin, b.payout_method, upi, enc, account ? account.slice(-4) : null, ifsc, holder]);
  await logPromoterAudit(null, {
    actorType: 'promoter', actorId: promoterId, action: 'promoter.payout_details_updated', promoterId,
    entityType: 'promoter', entityId: promoterId, after: { payout_method: b.payout_method, pan: maskPan(pan), gstin: !!gstin }, ip
  });
  return selfView(up.rows[0]);
}

async function acceptAgreement(promoterId, version, { ip } = {}) {
  const settings = (await settingsService.getCurrent()).settings;
  if (version !== settings.agreement_version) throw httpError('The agreement has changed. Reload and read the latest version.', 409);
  await pool.query(`UPDATE promoters SET agreement_version = $2, agreement_accepted_at = now(), updated_at = now() WHERE id = $1`, [promoterId, version]);
  await logPromoterAudit(null, { actorType: 'promoter', actorId: promoterId, action: 'promoter.agreement_accepted', promoterId, after: { version }, ip });
  return { agreement_version: version };
}

async function list({ status, q, limit = 200 } = {}) {
  const params = [];
  const where = [];
  if (status && status !== 'all') { params.push(status); where.push(`p.status = $${params.length}`); }
  if (q) { params.push(`%${String(q).toLowerCase()}%`); where.push(`(LOWER(p.name) LIKE $${params.length} OR LOWER(p.email) LIKE $${params.length} OR p.code LIKE UPPER($${params.length}) OR p.phone LIKE $${params.length})`); }
  params.push(Math.min(Number(limit) || 200, 500));
  const res = await pool.query(`
    SELECT ${PUBLIC_COLUMNS.split(',').map(c => 'p.' + c.trim()).join(', ')}, s.name AS scheme_name,
      (SELECT COUNT(*) FROM tenant_referrals r WHERE r.promoter_id = p.id AND r.status <> 'revoked')::int AS referral_count,
      (SELECT COUNT(*) FROM tenant_referrals r WHERE r.promoter_id = p.id AND r.status = 'flagged')::int AS flagged_count,
      (SELECT COALESCE(SUM(amount_paise), 0) FROM promoter_commissions c WHERE c.promoter_id = p.id AND c.status = 'pending')::bigint AS pending_paise,
      (SELECT COALESCE(SUM(amount_paise), 0) FROM promoter_commissions c WHERE c.promoter_id = p.id AND c.status = 'available')::bigint AS available_paise,
      (SELECT COALESCE(SUM(amount_paise), 0) FROM promoter_commissions c WHERE c.promoter_id = p.id AND c.status = 'paid')::bigint AS paid_paise
    FROM promoters p JOIN commission_schemes s ON s.id = p.scheme_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.created_at DESC
    LIMIT $${params.length}`, params);
  return res.rows.map(r => ({ ...r, pan: maskPan(r.pan), pending_paise: Number(r.pending_paise), available_paise: Number(r.available_paise), paid_paise: Number(r.paid_paise) }));
}

async function getDetail(id) {
  const p = await pool.query(`SELECT ${PUBLIC_COLUMNS} FROM promoters WHERE id = $1`, [id]);
  if (!p.rows.length) throw httpError('Promoter not found', 404);
  const referrals = await pool.query(`
    SELECT r.*, r.window_start::text AS window_start, t.status AS tenant_status, t.plan AS tenant_plan,
      (SELECT COALESCE(SUM(amount_paise), 0) FROM promoter_commissions c WHERE c.referral_id = r.id AND c.status <> 'void')::bigint AS earned_paise
    FROM tenant_referrals r LEFT JOIN tenants t ON t.id = r.tenant_id
    WHERE r.promoter_id = $1 ORDER BY r.attributed_at DESC`, [id]);
  const audit = await pool.query(`
    SELECT a.*, s.name AS actor_name FROM promoter_audit_logs a LEFT JOIN staff s ON s.id = a.actor_id AND a.actor_type = 'staff'
    WHERE a.promoter_id = $1 ORDER BY a.created_at DESC LIMIT 50`, [id]);
  return {
    promoter: { ...p.rows[0], pan: maskPan(p.rows[0].pan) },
    referrals: referrals.rows.map(r => ({ ...r, owner_fingerprints: undefined, earned_paise: Number(r.earned_paise) })),
    audit: audit.rows
  };
}

module.exports = {
  PUBLIC_COLUMNS, maskPan, selfView, generateCode, apply, adminCreate, changeStatus, updateTerms, reviewKyc,
  updatePayoutDetails, acceptAgreement, list, getDetail, createResetToken, todayIST
};

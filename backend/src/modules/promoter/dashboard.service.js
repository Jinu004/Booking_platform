/**
 * Read models: the partner dashboard (always scoped to one promoter) and the super admin overview.
 * Partner queries never return patient, conversation or contact data of clinics.
 */
const pool = require('../../config/database');
const settingsService = require('./settings.service');
const { addMonths, monthStart, todayIST } = require('../../utils/money');

const n = (v) => Number(v || 0);

async function partnerSummary(promoterId) {
  const settings = (await settingsService.getCurrent()).settings;
  const thisMonth = monthStart(todayIST());
  const q = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM tenant_referrals WHERE promoter_id = $1 AND status <> 'revoked')::int AS clinics_referred,
      (SELECT COUNT(*) FROM tenant_referrals r JOIN tenants t ON t.id = r.tenant_id
         WHERE r.promoter_id = $1 AND r.status <> 'revoked' AND t.status = 'pending')::int AS awaiting_activation,
      (SELECT COUNT(DISTINCT r.id) FROM tenant_referrals r JOIN subscription_payments p ON p.tenant_id = r.tenant_id
         WHERE r.promoter_id = $1 AND r.status <> 'revoked' AND p.status IN ('captured', 'partially_refunded')
           AND p.period_end >= (now() AT TIME ZONE 'Asia/Kolkata')::date)::int AS active_paying,
      (SELECT COALESCE(SUM(amount_paise), 0) FROM promoter_commissions WHERE promoter_id = $1 AND status = 'pending')::bigint AS pending_paise,
      (SELECT COALESCE(SUM(amount_paise), 0) FROM promoter_commissions WHERE promoter_id = $1 AND status = 'available')::bigint AS available_paise,
      (SELECT COALESCE(SUM(amount_paise), 0) FROM promoter_commissions WHERE promoter_id = $1 AND status = 'paid')::bigint AS paid_paise,
      (SELECT COALESCE(SUM(amount_paise), 0) FROM promoter_commissions WHERE promoter_id = $1 AND status <> 'void'
         AND created_at >= ($2::date AT TIME ZONE 'Asia/Kolkata'))::bigint AS this_month_paise,
      (SELECT MIN(available_at) FROM promoter_commissions WHERE promoter_id = $1 AND status = 'pending' AND amount_paise > 0) AS next_release_at
  `, [promoterId, thisMonth]);
  const p = await pool.query(`SELECT override_min_payout_paise, kyc_status, payout_method, agreement_version FROM promoters WHERE id = $1`, [promoterId]);
  const r = q.rows[0];
  const now = todayIST();
  let nextRun = `${now.slice(0, 8)}${String(settings.payout_run_day).padStart(2, '0')}`;
  if (nextRun < now) nextRun = `${addMonths(monthStart(now), 1).slice(0, 8)}${String(settings.payout_run_day).padStart(2, '0')}`;
  return {
    clinics_referred: r.clinics_referred,
    awaiting_activation: r.awaiting_activation,
    active_paying: r.active_paying,
    pending_paise: n(r.pending_paise),
    available_paise: n(r.available_paise),
    paid_paise: n(r.paid_paise),
    this_month_paise: n(r.this_month_paise),
    next_release_at: r.next_release_at,
    min_payout_paise: p.rows[0].override_min_payout_paise != null ? n(p.rows[0].override_min_payout_paise) : settings.min_payout_paise,
    next_payout_date: settings.payout_frequency === 'monthly' ? nextRun : null,
    hold_days: settings.hold_days,
    kyc_status: p.rows[0].kyc_status,
    has_payout_details: !!p.rows[0].payout_method,
    kyc_required: settings.kyc_required_for_payout,
    agreement_current: p.rows[0].agreement_version === settings.agreement_version,
    agreement_version: settings.agreement_version
  };
}

async function partnerClinics(promoterId) {
  const q = await pool.query(`
    SELECT r.id, r.tenant_name AS clinic_name, r.attributed_at, r.status AS referral_status, r.no_commission,
      r.window_start::text AS window_start,
      CASE WHEN t.id IS NULL THEN 'closed' ELSE t.status END AS clinic_status,
      COALESCE(pl.name, t.plan) AS plan,
      (SELECT city FROM clinic_profiles cp WHERE cp.tenant_id = t.id LIMIT 1) AS city,
      lt.commission_months,
      (SELECT COALESCE(SUM(amount_paise), 0) FROM promoter_commissions c
         WHERE c.referral_id = r.id AND c.promoter_id = $1 AND c.status <> 'void')::bigint AS earned_paise,
      (SELECT MAX(p.paid_at) FROM subscription_payments p WHERE p.tenant_id = r.tenant_id AND p.status IN ('captured', 'partially_refunded')) AS last_paid_at
    FROM tenant_referrals r
    LEFT JOIN tenants t ON t.id = r.tenant_id
    LEFT JOIN plans pl ON pl.id = t.plan
    LEFT JOIN LATERAL (SELECT commission_months FROM referral_terms WHERE referral_id = r.id ORDER BY effective_from DESC LIMIT 1) lt ON true
    WHERE r.promoter_id = $1
    ORDER BY r.attributed_at DESC`, [promoterId]);
  const { windowEnd } = require('../../utils/money');
  return q.rows.map(r => ({
    ...r,
    earned_paise: n(r.earned_paise),
    // Flags are shown as "under review" without the internal reason
    referral_status: r.referral_status === 'flagged' ? 'under_review' : r.referral_status,
    commission_ends: r.window_start ? windowEnd(r.window_start, r.commission_months) : null
  }));
}

async function partnerEarnings(promoterId, { status, from, to, limit = 100, offset = 0 } = {}) {
  const params = [promoterId];
  const where = ['c.promoter_id = $1'];
  if (status && ['pending', 'available', 'paid', 'void'].includes(status)) { params.push(status); where.push(`c.status = $${params.length}`); }
  if (from) { params.push(from); where.push(`c.created_at >= ($${params.length}::date AT TIME ZONE 'Asia/Kolkata')`); }
  if (to) { params.push(to); where.push(`c.created_at < (($${params.length}::date + 1) AT TIME ZONE 'Asia/Kolkata')`); }
  params.push(Math.min(Number(limit) || 100, 500), Math.max(Number(offset) || 0, 0));
  const q = await pool.query(`
    SELECT c.id, c.created_at, c.tenant_name AS clinic_name, c.entry_type, c.base_paise, c.rate_bps, c.eligible_days, c.period_days,
      c.amount_paise, c.status, c.available_at, c.note, c.void_reason, p.period_start::text AS period_start, p.period_end::text AS period_end,
      po.period_month::text AS payout_month
    FROM promoter_commissions c
    LEFT JOIN subscription_payments p ON p.id = c.payment_id
    LEFT JOIN promoter_payouts po ON po.id = c.payout_id
    WHERE ${where.join(' AND ')}
    ORDER BY c.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return q.rows.map(r => ({ ...r, amount_paise: n(r.amount_paise), base_paise: n(r.base_paise) }));
}

async function partnerMonthly(promoterId, months = 12) {
  const start = addMonths(monthStart(todayIST()), -(months - 1));
  const q = await pool.query(`
    SELECT to_char(date_trunc('month', c.created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month,
      COALESCE(SUM(c.amount_paise), 0)::bigint AS earned_paise
    FROM promoter_commissions c
    WHERE c.promoter_id = $1 AND c.status <> 'void' AND c.created_at >= ($2::date AT TIME ZONE 'Asia/Kolkata')
    GROUP BY 1 ORDER BY 1`, [promoterId, start]);
  const paid = await pool.query(`
    SELECT to_char(period_month, 'YYYY-MM') AS month, COALESCE(SUM(net_paise), 0)::bigint AS paid_paise
    FROM promoter_payouts WHERE promoter_id = $1 AND status = 'paid' AND period_month >= $2 GROUP BY 1`, [promoterId, start]);
  const byMonth = Object.fromEntries(q.rows.map(r => [r.month, n(r.earned_paise)]));
  const paidBy = Object.fromEntries(paid.rows.map(r => [r.month, n(r.paid_paise)]));
  const out = [];
  for (let i = 0; i < months; i++) {
    const m = addMonths(start, i).slice(0, 7);
    out.push({ month: m, earned_paise: byMonth[m] || 0, paid_paise: paidBy[m] || 0 });
  }
  return out;
}

async function partnerPayouts(promoterId) {
  const q = await pool.query(`
    SELECT id, period_month::text AS period_month, gross_paise, gst_paise, tds_paise, net_paise, status, utr, paid_at, payout_method, payout_destination
    FROM promoter_payouts WHERE promoter_id = $1 AND status <> 'cancelled' ORDER BY period_month DESC`, [promoterId]);
  return q.rows.map(r => ({ ...r, gross_paise: n(r.gross_paise), gst_paise: n(r.gst_paise), tds_paise: n(r.tds_paise), net_paise: n(r.net_paise) }));
}

async function adminOverview() {
  const q = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM promoters WHERE status = 'active')::int AS active_promoters,
      (SELECT COUNT(*) FROM promoters WHERE status = 'pending')::int AS pending_applications,
      (SELECT COUNT(*) FROM promoters WHERE kyc_status = 'submitted')::int AS kyc_to_review,
      (SELECT COUNT(*) FROM tenant_referrals WHERE status = 'flagged')::int AS flagged_referrals,
      (SELECT COUNT(*) FROM tenant_referrals WHERE status <> 'revoked')::int AS referred_clinics,
      (SELECT COALESCE(SUM(amount_paise), 0) FROM promoter_commissions WHERE status = 'pending')::bigint AS pending_paise,
      (SELECT COALESCE(SUM(amount_paise), 0) FROM promoter_commissions WHERE status = 'available')::bigint AS available_paise,
      (SELECT COALESCE(SUM(net_paise), 0) FROM promoter_payouts WHERE status = 'paid'
         AND paid_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'))::bigint AS paid_this_month_paise,
      (SELECT COUNT(*) FROM promoter_payouts WHERE status IN ('draft', 'approved'))::int AS open_payouts
  `);
  const top = await pool.query(`
    SELECT p.id, p.name, p.code, COUNT(DISTINCT r.id)::int AS clinics,
      COALESCE((SELECT SUM(amount_paise) FROM promoter_commissions c WHERE c.promoter_id = p.id AND c.status <> 'void'), 0)::bigint AS earned_paise
    FROM promoters p LEFT JOIN tenant_referrals r ON r.promoter_id = p.id AND r.status <> 'revoked'
    WHERE p.status = 'active' GROUP BY p.id ORDER BY earned_paise DESC, clinics DESC LIMIT 10`);
  const flagged = await pool.query(`
    SELECT r.tenant_id, r.tenant_name, r.flag_reason, r.attributed_at, p.name AS promoter_name
    FROM tenant_referrals r JOIN promoters p ON p.id = r.promoter_id WHERE r.status = 'flagged' ORDER BY r.attributed_at DESC LIMIT 50`);
  const r = q.rows[0];
  const settings = await settingsService.getCurrent();
  return {
    ...r,
    pending_paise: n(r.pending_paise), available_paise: n(r.available_paise), paid_this_month_paise: n(r.paid_this_month_paise),
    top_promoters: top.rows.map(t => ({ ...t, earned_paise: n(t.earned_paise) })),
    flagged: flagged.rows,
    program_enabled: settings.settings.program_enabled,
    freeze_accruals: settings.settings.freeze_accruals,
    settings_version: settings.version
  };
}

async function adminLedger({ promoterId, tenantId, status, limit = 200 } = {}) {
  const params = [];
  const where = [];
  if (promoterId) { params.push(promoterId); where.push(`c.promoter_id = $${params.length}`); }
  if (tenantId) { params.push(tenantId); where.push(`c.tenant_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`c.status = $${params.length}`); }
  params.push(Math.min(Number(limit) || 200, 1000));
  const q = await pool.query(`
    SELECT c.*, p.name AS promoter_name, sp.period_start::text AS period_start, sp.period_end::text AS period_end,
      s.name AS scheme_name, v.version AS scheme_version, ps.version AS settings_version
    FROM promoter_commissions c
    JOIN promoters p ON p.id = c.promoter_id
    LEFT JOIN subscription_payments sp ON sp.id = c.payment_id
    LEFT JOIN commission_scheme_versions v ON v.id = c.scheme_version_id
    LEFT JOIN commission_schemes s ON s.id = v.scheme_id
    LEFT JOIN promoter_program_settings ps ON ps.id = c.settings_version_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.created_at DESC LIMIT $${params.length}`, params);
  return q.rows.map(r => ({ ...r, amount_paise: n(r.amount_paise), base_paise: n(r.base_paise) }));
}

async function adminAudit({ limit = 100 } = {}) {
  const q = await pool.query(`
    SELECT a.*, s.name AS actor_name, p.name AS promoter_name FROM promoter_audit_logs a
    LEFT JOIN staff s ON s.id = a.actor_id AND a.actor_type = 'staff'
    LEFT JOIN promoters p ON p.id = a.promoter_id
    ORDER BY a.created_at DESC LIMIT $1`, [Math.min(Number(limit) || 100, 500)]);
  return q.rows;
}

module.exports = { partnerSummary, partnerClinics, partnerEarnings, partnerMonthly, partnerPayouts, adminOverview, adminLedger, adminAudit };

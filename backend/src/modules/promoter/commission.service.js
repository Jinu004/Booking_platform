/**
 * Commission engine. Every function takes a transaction client so the ledger always changes in the
 * same transaction as the payment that caused it.
 *
 * Ledger rules: entries are never deleted and their amounts never change. Refunds and corrections
 * are new entries (reversal / adjustment). The DB trigger in migration 047 enforces this.
 */
const settingsService = require('./settings.service');
const { tierFor } = require('./scheme.service');
const { termsFor, activePayingCount } = require('./terms.service');
const { logPromoterAudit } = require('./promoter.audit');
const {
  mulDivFloor, daysInclusive, overlapDays, windowEnd, todayIST
} = require('../../utils/money');

const DAY_MS = 24 * 60 * 60 * 1000;

function dateStr(d) {
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(d).slice(0, 10);
}

/**
 * Pure calculation for one payment. Exported for unit tests.
 * @returns {{ amount, base, netBasis, rate, rateSource, tierIndex, eligibleDays, periodDays, capped } | null}
 */
function calculate({ payment, windowStart, terms, version, settings, liveTierIndex = null }) {
  const periodStart = dateStr(payment.period_start);
  const periodEnd = dateStr(payment.period_end);
  const periodDays = daysInclusive(periodStart, periodEnd);
  const wEnd = windowEnd(windowStart, terms.commission_months);
  const eligibleDays = overlapDays(periodStart, periodEnd, windowStart, wEnd);
  if (eligibleDays <= 0) return null;

  let rate;
  let rateSource;
  let tierIndex = null;
  const planRates = version.plan_rates || {};
  const tiers = Array.isArray(version.tiers) ? version.tiers : [];
  if (terms.override_rate_bps != null) {
    rate = terms.override_rate_bps; rateSource = 'override';
  } else if (payment.plan_id && planRates[payment.plan_id] != null) {
    rate = planRates[payment.plan_id]; rateSource = 'plan_rate';
  } else if (tiers.length) {
    if (version.tier_mode === 'locked' && terms.locked_tier_rate_bps != null) {
      rate = terms.locked_tier_rate_bps; tierIndex = terms.locked_tier_index;
    } else {
      tierIndex = liveTierIndex == null ? 0 : Math.min(liveTierIndex, tiers.length - 1);
      rate = tiers[tierIndex].rate_bps;
    }
    rateSource = 'tier';
  } else {
    rate = version.base_rate_bps; rateSource = 'base';
  }

  const net = Number(payment.net_paise);
  const gross = Number(payment.gross_paise);
  const refunded = Number(payment.refunded_paise || 0);
  const netBasis = net - refunded;
  // Refunds are recorded without tax; with a gross base, scale the refund up by gross/net
  const base = settings.exclude_gst ? netBasis : gross - mulDivFloor(refunded, gross, net);
  if (base <= 0) return null;

  let amount = mulDivFloor(base, BigInt(eligibleDays) * BigInt(rate), BigInt(periodDays) * 10000n);
  let capped = false;
  if (version.monthly_cap_paise != null) {
    const months = Math.max(1, Math.round(eligibleDays / 30));
    const cap = Number(version.monthly_cap_paise) * months;
    if (amount > cap) { amount = cap; capped = true; }
  }
  return { amount, base, netBasis, rate, rateSource, tierIndex, eligibleDays, periodDays, capped, windowEnd: wEnd };
}

/**
 * Creates the commission entry for a payment (idempotent: a second call returns the existing entry).
 * Returns { entry, bonus, skipped } where skipped is a reason string when nothing was created.
 */
async function accrueForPayment(client, paymentId, { actor = null } = {}) {
  const settingsRow = await settingsService.getCurrent(client);
  const settings = settingsRow.settings;

  const pq = await client.query(`SELECT * FROM subscription_payments WHERE id = $1 FOR UPDATE`, [paymentId]);
  const payment = pq.rows[0];
  if (!payment) return { skipped: 'payment_not_found' };
  if (!['captured', 'partially_refunded'].includes(payment.status)) return { skipped: 'payment_not_captured' };
  if (!payment.tenant_id) return { skipped: 'no_tenant' };

  const existing = await client.query(
    `SELECT * FROM promoter_commissions WHERE payment_id = $1 AND entry_type = 'commission'`, [paymentId]);
  if (existing.rows.length) return { entry: existing.rows[0], skipped: 'already_accrued' };

  // Permanent skips are recorded on the payment so the nightly reconciliation does not retry them.
  // Temporary ones (no referral yet, accruals frozen) are not recorded and are retried.
  const skipForGood = async (reason) => {
    await client.query(`UPDATE subscription_payments SET commission_skip_reason = $2 WHERE id = $1`, [payment.id, reason]);
    return { skipped: reason };
  };

  const rq = await client.query(`SELECT * FROM tenant_referrals WHERE tenant_id = $1 FOR UPDATE`, [payment.tenant_id]);
  const referral = rq.rows[0];
  if (!referral) return { skipped: 'no_referral' };
  if (referral.status === 'revoked') return skipForGood('referral_revoked');
  if (referral.no_commission) return skipForGood('no_commission');
  if (settings.freeze_accruals) return { skipped: 'accruals_frozen' };
  if (!settings.commissionable_payment_types.includes(payment.payment_type)) return skipForGood('payment_type_not_commissionable');

  const periodStart = dateStr(payment.period_start);
  const terms = await termsFor(client, referral.id, periodStart);
  if (!terms) return skipForGood('no_terms');
  // A terminated (or rejected) promoter earns nothing on payments recorded after the termination
  const ps = await client.query(`SELECT status FROM promoters WHERE id = $1`, [terms.promoter_id]);
  if (['terminated', 'rejected'].includes(ps.rows[0]?.status)) return skipForGood('promoter_terminated');
  const vq = await client.query(`SELECT * FROM commission_scheme_versions WHERE id = $1`, [terms.scheme_version_id]);
  const version = vq.rows[0];

  // Commission window start
  let windowStart = referral.window_start ? dateStr(referral.window_start) : null;
  if (!windowStart) {
    if (settings.commission_starts_at === 'attribution') {
      windowStart = todayISTFrom(referral.attributed_at);
    } else {
      // The earliest commissionable payment of the clinic, not just the first one processed
      const first = await client.query(`
        SELECT MIN(period_start)::text AS d FROM subscription_payments
        WHERE tenant_id = $1 AND status IN ('captured', 'partially_refunded') AND payment_type = ANY($2)`,
      [payment.tenant_id, settings.commissionable_payment_types]);
      windowStart = first.rows[0].d && first.rows[0].d < periodStart ? first.rows[0].d : periodStart;
    }
    await client.query(`UPDATE tenant_referrals SET window_start = $1, updated_at = now() WHERE id = $2`, [windowStart, referral.id]);
  } else if (settings.commission_starts_at === 'first_payment' && periodStart < windowStart) {
    // A backdated, earlier payment: move the start back, unless that would push an already
    // accrued period outside the (shorter) window
    const newEnd = windowEnd(periodStart, terms.commission_months);
    const latest = await client.query(`
      SELECT MAX(p.period_end)::text AS d FROM promoter_commissions c JOIN subscription_payments p ON p.id = c.payment_id
      WHERE c.referral_id = $1 AND c.entry_type = 'commission' AND c.status <> 'void'`, [referral.id]);
    if (newEnd == null || !latest.rows[0].d || latest.rows[0].d <= newEnd) {
      windowStart = periodStart;
      await client.query(`UPDATE tenant_referrals SET window_start = $1, updated_at = now() WHERE id = $2`, [windowStart, referral.id]);
    }
  }

  let liveTierIndex = null;
  if (version.tier_mode === 'live' && Array.isArray(version.tiers) && version.tiers.length) {
    liveTierIndex = tierFor(version.tiers, await activePayingCount(client, terms.promoter_id, periodStart));
  }

  const calc = calculate({ payment, windowStart, terms, version, settings, liveTierIndex });
  if (!calc) return skipForGood('outside_window');

  const availableAt = new Date(new Date(payment.paid_at).getTime() + settings.hold_days * DAY_MS);
  const ins = await client.query(`
    INSERT INTO promoter_commissions
      (promoter_id, referral_id, tenant_id, tenant_name, payment_id, entry_type, base_paise, net_basis_paise,
       rate_bps, rate_source, terms_id, scheme_version_id, settings_version_id, tier_index,
       eligible_days, period_days, capped, amount_paise, status, available_at)
    VALUES ($1, $2, $3, $4, $5, 'commission', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'pending', $18)
    ON CONFLICT (payment_id) WHERE entry_type = 'commission' DO NOTHING
    RETURNING *`,
  [terms.promoter_id, referral.id, payment.tenant_id, payment.tenant_name, payment.id, calc.base, calc.netBasis,
    calc.rate, calc.rateSource, terms.id, version.id, settingsRow.id, calc.tierIndex,
    calc.eligibleDays, calc.periodDays, calc.capped, calc.amount, availableAt]);
  if (!ins.rows.length) {
    const again = await client.query(`SELECT * FROM promoter_commissions WHERE payment_id = $1 AND entry_type = 'commission'`, [paymentId]);
    return { entry: again.rows[0], skipped: 'already_accrued' };
  }
  const entry = ins.rows[0];

  let bonus = null;
  const earlier = await client.query(
    `SELECT 1 FROM promoter_commissions WHERE referral_id = $1 AND entry_type = 'commission' AND status <> 'void' AND id <> $2 LIMIT 1`,
    [referral.id, entry.id]);
  if (version.first_payment_bonus_paise != null && Number(version.first_payment_bonus_paise) > 0 && !earlier.rows.length) {
    const b = await client.query(`
      INSERT INTO promoter_commissions
        (promoter_id, referral_id, tenant_id, tenant_name, payment_id, entry_type, rate_source, terms_id,
         scheme_version_id, settings_version_id, amount_paise, status, available_at, note)
      VALUES ($1, $2, $3, $4, $5, 'bonus', 'bonus', $6, $7, $8, $9, 'pending', $10, 'First payment bonus')
      ON CONFLICT (referral_id) WHERE entry_type = 'bonus' AND status <> 'void' DO NOTHING RETURNING *`,
    [terms.promoter_id, referral.id, payment.tenant_id, payment.tenant_name, payment.id, terms.id, version.id,
      settingsRow.id, version.first_payment_bonus_paise, availableAt]);
    bonus = b.rows[0] || null;
  }

  await logPromoterAudit(client, {
    ...(actor || { actorType: 'system' }), action: 'commission.accrued', promoterId: terms.promoter_id,
    tenantId: payment.tenant_id, entityType: 'promoter_commission', entityId: entry.id,
    after: { payment_id: payment.id, amount_paise: calc.amount, rate_bps: calc.rate, rate_source: calc.rateSource, eligible_days: calc.eligibleDays, period_days: calc.periodDays }
  });
  return { entry, bonus };
}

function todayISTFrom(ts) {
  return todayIST(new Date(ts));
}

/**
 * Applies a refund (or void) of a payment to its commission and bonus entries.
 * `refundPaise` is the newly refunded amount (without tax). `full` = payment fully refunded or voided.
 */
async function applyRefund(client, payment, { refundPaise, full, reason, actor }) {
  const settings = (await settingsService.getCurrent(client)).settings;
  const entries = await client.query(`
    SELECT * FROM promoter_commissions
    WHERE payment_id = $1 AND entry_type IN ('commission', 'bonus') FOR UPDATE`, [payment.id]);
  const results = [];
  for (const orig of entries.rows) {
    if (orig.status === 'void') continue;
    const revs = await client.query(`
      SELECT * FROM promoter_commissions WHERE reverses_id = $1 AND status <> 'void' FOR UPDATE`, [orig.id]);
    const reversed = revs.rows.reduce((s, r) => s + Number(r.amount_paise), 0); // negative
    const remaining = Number(orig.amount_paise) + reversed;
    if (remaining <= 0) continue;

    const unpaidAndFree = ['pending', 'available'].includes(orig.status) && !orig.payout_id;
    const lockedInPayout = orig.status !== 'paid' && !!orig.payout_id;

    // The bonus is only taken back when the payment is fully refunded
    if (orig.entry_type === 'bonus' && !full) continue;

    if (full && unpaidAndFree && revs.rows.every(r => !r.payout_id && r.status !== 'paid')) {
      await client.query(`UPDATE promoter_commissions SET status = 'void', void_reason = $2 WHERE id = $1`,
        [orig.id, `Payment refunded${reason ? `: ${String(reason).slice(0, 200)}` : ''}`]);
      for (const r of revs.rows) {
        await client.query(`UPDATE promoter_commissions SET status = 'void', void_reason = $2 WHERE id = $1`, [r.id, 'Original voided']);
      }
      results.push({ entry: orig.id, action: 'voided' });
      continue;
    }

    if (orig.status === 'paid' && settings.refund_after_payout_policy === 'absorb') {
      results.push({ entry: orig.id, action: 'absorbed' });
      continue;
    }

    let amount;
    if (full || orig.entry_type === 'bonus') {
      amount = remaining;
    } else {
      const basis = Number(orig.net_basis_paise) || Number(payment.net_paise);
      amount = Math.min(remaining, mulDivFloor(Number(orig.amount_paise), refundPaise, basis));
    }
    if (amount <= 0) continue;

    const status = (orig.status === 'paid' || lockedInPayout) ? 'available' : orig.status;
    const ins = await client.query(`
      INSERT INTO promoter_commissions
        (promoter_id, referral_id, tenant_id, tenant_name, payment_id, entry_type, rate_bps, rate_source,
         terms_id, scheme_version_id, settings_version_id, amount_paise, status, available_at, reverses_id, note)
      VALUES ($1, $2, $3, $4, $5, 'reversal', $6, 'reversal', $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
    [orig.promoter_id, orig.referral_id, orig.tenant_id, orig.tenant_name, payment.id, orig.rate_bps,
      orig.terms_id, orig.scheme_version_id, orig.settings_version_id, -amount, status,
      status === 'available' ? new Date() : orig.available_at, orig.id,
      reason ? `Refund: ${String(reason).slice(0, 200)}` : 'Refund']);
    results.push({ entry: orig.id, action: 'reversed', reversal: ins.rows[0].id, amount_paise: -amount });
  }
  if (results.length) {
    await logPromoterAudit(client, {
      ...(actor || { actorType: 'system' }), action: 'commission.refund_applied', tenantId: payment.tenant_id,
      entityType: 'subscription_payment', entityId: payment.id, after: { refund_paise: refundPaise, full, results }, reason
    });
  }
  return results;
}

/**
 * Daily release: pending → available once the hold period is over and nothing blocks it.
 * Returns the number of released entries.
 */
async function releaseDue(client, now = new Date()) {
  const settings = (await settingsService.getCurrent(client)).settings;
  const promoterOk = `(pr.status = 'active'
      OR (pr.status = 'suspended' AND $2 = 'continue')
      OR (pr.status = 'terminated' AND $3 = 'pay_out'))`;
  const main = await client.query(`
    UPDATE promoter_commissions c SET status = 'available'
    FROM promoters pr
    WHERE pr.id = c.promoter_id AND c.status = 'pending' AND c.entry_type IN ('commission', 'bonus', 'adjustment')
      AND c.available_at <= $1 AND ${promoterOk}
      AND (c.referral_id IS NULL OR EXISTS (SELECT 1 FROM tenant_referrals r WHERE r.id = c.referral_id AND r.status = 'active'))
      AND (c.payment_id IS NULL OR EXISTS (SELECT 1 FROM subscription_payments p WHERE p.id = c.payment_id
           AND p.status IN ('captured', 'partially_refunded')))
    RETURNING c.id`, [now, settings.suspended_promoter_policy, settings.terminated_promoter_policy]);
  const rev = await client.query(`
    UPDATE promoter_commissions c SET status = 'available'
    FROM promoter_commissions o
    WHERE o.id = c.reverses_id AND c.status = 'pending' AND c.entry_type = 'reversal'
      AND o.status IN ('available', 'paid')
    RETURNING c.id`);
  return main.rowCount + rev.rowCount;
}

/**
 * Safety net: captured payments of referred clinics without a commission entry (e.g. created while
 * accruals were frozen). Returns how many were accrued.
 */
async function reconcile(client, { limit = 500 } = {}) {
  const settings = (await settingsService.getCurrent(client)).settings;
  if (settings.freeze_accruals) return 0;
  const q = await client.query(`
    SELECT p.id FROM subscription_payments p
    JOIN tenant_referrals r ON r.tenant_id = p.tenant_id AND r.status <> 'revoked' AND NOT r.no_commission
    JOIN promoters pr ON pr.id = r.promoter_id AND pr.status NOT IN ('terminated', 'rejected')
    WHERE p.status IN ('captured', 'partially_refunded') AND p.payment_type = ANY($1)
      AND p.commission_skip_reason IS NULL
      AND NOT EXISTS (SELECT 1 FROM promoter_commissions c WHERE c.payment_id = p.id AND c.entry_type = 'commission')
    ORDER BY p.paid_at LIMIT $2`, [settings.commissionable_payment_types, limit]);
  let created = 0;
  for (const row of q.rows) {
    const r = await accrueForPayment(client, row.id);
    if (r.entry && !r.skipped) created++;
  }
  return created;
}

/** Manual adjustment by a super admin (positive or negative), available immediately */
async function addAdjustment(client, { promoterId, tenantId = null, amountPaise, note }, actor) {
  if (!Number.isInteger(amountPaise) || amountPaise === 0) throw Object.assign(new Error('Amount must be a non-zero whole number of paise'), { status: 400 });
  if (!note || !String(note).trim()) throw Object.assign(new Error('A note is required'), { status: 400 });
  const p = await client.query(`SELECT id FROM promoters WHERE id = $1`, [promoterId]);
  if (!p.rows.length) throw Object.assign(new Error('Promoter not found'), { status: 404 });
  let referral = null;
  if (tenantId) {
    const r = await client.query(`SELECT * FROM tenant_referrals WHERE tenant_id = $1 AND promoter_id = $2`, [tenantId, promoterId]);
    if (!r.rows.length) throw Object.assign(new Error('This clinic is not referred by this promoter'), { status: 400 });
    referral = r.rows[0];
  }
  const settingsRow = await settingsService.getCurrent(client);
  const ins = await client.query(`
    INSERT INTO promoter_commissions
      (promoter_id, referral_id, tenant_id, tenant_name, entry_type, rate_source, settings_version_id,
       amount_paise, status, available_at, note, created_by)
    VALUES ($1, $2, $3, $4, 'adjustment', 'manual', $5, $6, 'available', now(), $7, $8) RETURNING *`,
  [promoterId, referral?.id || null, referral?.tenant_id || null, referral?.tenant_name || null, settingsRow.id,
    amountPaise, String(note).trim(), actor?.actorType === 'staff' ? actor.actorId : null]);
  await logPromoterAudit(client, {
    ...actor, action: 'commission.adjustment', promoterId, tenantId, entityType: 'promoter_commission',
    entityId: ins.rows[0].id, after: { amount_paise: amountPaise }, reason: note
  });
  return ins.rows[0];
}

/**
 * Voids the unpaid earnings of a referral that are not inside a payout (used when revoking for fraud).
 * Money the promoter owes back (negative reversals of already-paid commission, negative adjustments)
 * is kept; only reversals of the entries voided here are voided with them.
 */
async function voidUnpaidForReferral(client, referralId, reason) {
  return voidUnpaid(client, { column: 'referral_id', id: referralId, reason });
}

/** Same for all of a promoter's entries (termination with the "forfeit" policy) */
async function voidUnpaidForPromoter(client, promoterId, reason) {
  return voidUnpaid(client, { column: 'promoter_id', id: promoterId, reason });
}

async function voidUnpaid(client, { column, id, reason }) {
  const pos = await client.query(`
    UPDATE promoter_commissions SET status = 'void', void_reason = $2
    WHERE ${column} = $1 AND status IN ('pending', 'available') AND payout_id IS NULL AND amount_paise > 0
    RETURNING id`, [id, reason]);
  const ids = pos.rows.map(r => r.id);
  let reversals = 0;
  if (ids.length) {
    const rev = await client.query(`
      UPDATE promoter_commissions SET status = 'void', void_reason = 'Original voided'
      WHERE reverses_id = ANY($1) AND status IN ('pending', 'available') AND payout_id IS NULL RETURNING id`, [ids]);
    reversals = rev.rowCount;
  }
  return ids.length + reversals;
}

module.exports = { calculate, accrueForPayment, applyRefund, releaseDue, reconcile, addAdjustment, voidUnpaidForReferral, voidUnpaidForPromoter, dateStr };

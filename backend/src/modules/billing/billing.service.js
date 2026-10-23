/**
 * Plans (single source of truth for prices) and subscription payments (money actually received).
 * Recording, refunding or voiding a payment updates the promoter commission ledger in the same transaction.
 */
const pool = require('../../config/database');
const commission = require('../promoter/commission.service');
const { logPromoterAudit } = require('../promoter/promoter.audit');
const { isValidDateString, todayIST, monthStart, addMonths } = require('../../utils/money');

class BillingError extends Error {
  constructor(message, status = 400, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const METHODS = ['upi', 'bank_transfer', 'cash', 'cheque', 'gateway'];
const TYPES = ['subscription', 'setup_fee', 'addon', 'other'];

// ---------- Plans ----------

async function listPlans({ activeOnly = false } = {}) {
  const q = await pool.query(
    `SELECT id, name, monthly_price_paise::bigint AS monthly_price_paise, is_active, sort_order, updated_at
     FROM plans ${activeOnly ? 'WHERE is_active' : ''} ORDER BY sort_order, id`);
  return q.rows.map(r => ({ ...r, monthly_price_paise: Number(r.monthly_price_paise) }));
}

async function planExists(db, id) {
  const q = await db.query('SELECT 1 FROM plans WHERE id = $1', [id]);
  return q.rows.length > 0;
}

async function updatePlan(id, { name, monthly_price_paise, is_active, reason }, actor) {
  if (!reason || !String(reason).trim()) throw new BillingError('A reason is required');
  if (monthly_price_paise !== undefined && !(Number.isInteger(monthly_price_paise) && monthly_price_paise >= 0 && monthly_price_paise <= 100000000)) {
    throw new BillingError('Invalid price');
  }
  if (name !== undefined && (!String(name).trim() || String(name).length > 50)) throw new BillingError('Invalid name');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query('SELECT * FROM plans WHERE id = $1 FOR UPDATE', [id]);
    if (!before.rows.length) throw new BillingError('Plan not found', 404);
    const after = await client.query(
      `UPDATE plans SET name = COALESCE($2, name), monthly_price_paise = COALESCE($3, monthly_price_paise),
         is_active = COALESCE($4, is_active), updated_at = now() WHERE id = $1 RETURNING *`,
      [id, name ?? null, monthly_price_paise ?? null, is_active ?? null]);
    await logPromoterAudit(client, { ...actor, action: 'plan.update', entityType: 'plan', before: before.rows[0], after: after.rows[0], reason });
    await client.query('COMMIT');
    return after.rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------- Payments ----------

function validatePaymentInput(b) {
  const errors = {};
  const intIn = (x, min, max) => Number.isInteger(x) && x >= min && x <= max;
  if (!intIn(b.gross_paise, 1, 10000000000)) errors.gross_paise = 'Amount must be more than 0';
  const tax = b.tax_paise === undefined || b.tax_paise === null || b.tax_paise === '' ? 0 : b.tax_paise;
  if (!intIn(tax, 0, 10000000000)) errors.tax_paise = 'Invalid tax amount';
  else if (!errors.gross_paise && tax >= b.gross_paise) errors.tax_paise = 'Tax must be less than the amount';
  if (!isValidDateString(b.period_start)) errors.period_start = 'Invalid date';
  if (!isValidDateString(b.period_end)) errors.period_end = 'Invalid date';
  if (!errors.period_start && !errors.period_end && b.period_end < b.period_start) errors.period_end = 'Must be on or after the start';
  if (!errors.period_start && !errors.period_end && b.period_end > addMonths(b.period_start, 36)) errors.period_end = 'A period can be at most 3 years';
  if (!METHODS.includes(b.method)) errors.method = 'Invalid method';
  const type = b.payment_type || 'subscription';
  if (!TYPES.includes(type)) errors.payment_type = 'Invalid payment type';
  const paidAt = b.paid_at ? new Date(b.paid_at) : null;
  if (!paidAt || isNaN(paidAt.getTime())) errors.paid_at = 'Invalid payment date';
  else if (paidAt.getTime() > Date.now() + 10 * 60 * 1000) errors.paid_at = 'Payment date cannot be in the future';
  if (b.external_ref != null && String(b.external_ref).length > 100) errors.external_ref = 'Too long';
  if (['upi', 'bank_transfer', 'gateway'].includes(b.method) && !String(b.external_ref || '').trim()) {
    errors.external_ref = 'Reference (UTR / transaction id) is required for this method';
  }
  return { errors, value: { ...b, tax_paise: tax, payment_type: type, paid_at: paidAt } };
}

/**
 * Records a payment for a tenant and creates the promoter commission in the same transaction.
 * Returns { payment, commission }.
 */
async function recordPayment(tenantId, input, actor) {
  const { errors, value } = validatePaymentInput(input || {});
  if (Object.keys(errors).length) throw new BillingError('Some fields are invalid', 400, errors);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = await client.query('SELECT id, name, plan FROM tenants WHERE id = $1', [tenantId]);
    if (!t.rows.length) throw new BillingError('Clinic not found', 404);
    const tenant = t.rows[0];
    const planId = value.plan_id || (value.payment_type === 'subscription' ? tenant.plan : null);
    if (planId && !(await planExists(client, planId))) throw new BillingError('Some fields are invalid', 400, { plan_id: 'Unknown plan' });

    // Without a reference (cash, cheque) a double submit cannot be caught by the unique index:
    // ask for confirmation when the same amount for the same period is already recorded.
    if (!value.external_ref && value.allow_duplicate !== true) {
      const dup = await client.query(`
        SELECT 1 FROM subscription_payments WHERE tenant_id = $1 AND period_start = $2 AND gross_paise = $3
          AND status <> 'voided' LIMIT 1`, [tenant.id, value.period_start, value.gross_paise]);
      if (dup.rows.length) {
        throw new BillingError('A payment with the same amount and period is already recorded for this clinic. Record it again anyway?', 409, { duplicate: true });
      }
    }

    const ins = await client.query(`
      INSERT INTO subscription_payments
        (tenant_id, tenant_name, plan_id, payment_type, gross_paise, tax_paise, period_start, period_end,
         paid_at, method, external_ref, recorded_by, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [tenant.id, tenant.name, planId, value.payment_type, value.gross_paise, value.tax_paise,
      value.period_start, value.period_end, value.paid_at, value.method,
      value.external_ref ? String(value.external_ref).trim() : null,
      actor?.actorType === 'staff' ? actor.actorId : null, value.notes ? String(value.notes).slice(0, 1000) : null]);
    const payment = ins.rows[0];
    await logPromoterAudit(client, {
      ...actor, action: 'payment.recorded', tenantId: tenant.id, entityType: 'subscription_payment', entityId: payment.id,
      after: { gross_paise: payment.gross_paise, tax_paise: payment.tax_paise, period_start: value.period_start, period_end: value.period_end, method: payment.method, external_ref: payment.external_ref }
    });
    const result = await commission.accrueForPayment(client, payment.id, { actor });
    await client.query('COMMIT');
    return { payment, commission: result.entry || null, commissionSkipped: result.skipped || null };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505' && String(err.constraint).includes('external_ref')) {
      throw new BillingError('A payment with this reference is already recorded', 409, { external_ref: 'Duplicate reference' });
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Refunds part or all of a payment (amount without tax) */
async function refundPayment(paymentId, { amount_paise, reason }, actor) {
  if (!reason || !String(reason).trim()) throw new BillingError('A reason is required');
  if (!Number.isInteger(amount_paise) || amount_paise <= 0) throw new BillingError('Refund amount must be more than 0');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pq = await client.query('SELECT * FROM subscription_payments WHERE id = $1 FOR UPDATE', [paymentId]);
    const p = pq.rows[0];
    if (!p) throw new BillingError('Payment not found', 404);
    if (!['captured', 'partially_refunded'].includes(p.status)) throw new BillingError(`A ${p.status} payment cannot be refunded`);
    const refundable = Number(p.net_paise) - Number(p.refunded_paise);
    if (amount_paise > refundable) throw new BillingError(`At most ₹${(refundable / 100).toFixed(2)} can be refunded`);
    const newRefunded = Number(p.refunded_paise) + amount_paise;
    const full = newRefunded === Number(p.net_paise);
    const up = await client.query(
      `UPDATE subscription_payments SET refunded_paise = $2, status = $3, updated_at = now() WHERE id = $1 RETURNING *`,
      [p.id, newRefunded, full ? 'refunded' : 'partially_refunded']);
    await logPromoterAudit(client, {
      ...actor, action: 'payment.refunded', tenantId: p.tenant_id, entityType: 'subscription_payment', entityId: p.id,
      before: { refunded_paise: p.refunded_paise, status: p.status }, after: { refunded_paise: newRefunded, status: up.rows[0].status }, reason
    });
    const effects = await commission.applyRefund(client, up.rows[0], { refundPaise: amount_paise, full, reason, actor });
    await client.query('COMMIT');
    return { payment: up.rows[0], commissionEffects: effects };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Voids a payment recorded by mistake (it is kept for the record) */
async function voidPayment(paymentId, { reason }, actor) {
  if (!reason || !String(reason).trim()) throw new BillingError('A reason is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pq = await client.query('SELECT * FROM subscription_payments WHERE id = $1 FOR UPDATE', [paymentId]);
    const p = pq.rows[0];
    if (!p) throw new BillingError('Payment not found', 404);
    if (p.status === 'voided') throw new BillingError('Payment is already voided');
    const remaining = Number(p.net_paise) - Number(p.refunded_paise);
    const up = await client.query(
      `UPDATE subscription_payments SET status = 'voided', updated_at = now(),
         notes = CONCAT_WS(E'\\n', notes, $2::text) WHERE id = $1 RETURNING *`,
      [p.id, `Voided: ${String(reason).trim()}`]);
    await logPromoterAudit(client, {
      ...actor, action: 'payment.voided', tenantId: p.tenant_id, entityType: 'subscription_payment', entityId: p.id,
      before: { status: p.status }, after: { status: 'voided' }, reason
    });
    const effects = remaining > 0
      ? await commission.applyRefund(client, up.rows[0], { refundPaise: remaining, full: true, reason: `Voided: ${reason}`, actor })
      : [];
    await client.query('COMMIT');
    return { payment: up.rows[0], commissionEffects: effects };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function listPayments(tenantId, { limit = 100 } = {}) {
  const q = await pool.query(`
    SELECT p.*, p.period_start::text AS period_start, p.period_end::text AS period_end, s.name AS recorded_by_name,
      (SELECT json_build_object('id', c.id, 'amount_paise', c.amount_paise, 'status', c.status, 'promoter_id', c.promoter_id)
         FROM promoter_commissions c WHERE c.payment_id = p.id AND c.entry_type = 'commission') AS commission
    FROM subscription_payments p LEFT JOIN staff s ON s.id = p.recorded_by
    WHERE p.tenant_id = $1 ORDER BY p.paid_at DESC LIMIT $2`, [tenantId, Math.min(Number(limit) || 100, 500)]);
  return q.rows;
}

/** Payments a clinic admin may see about their own account (no internal notes or staff names) */
async function listOwnPayments(tenantId) {
  const q = await pool.query(`
    SELECT p.id, pl.name AS plan_name, p.payment_type, p.gross_paise, p.tax_paise, p.net_paise, p.refunded_paise,
      p.period_start::text AS period_start, p.period_end::text AS period_end, p.paid_at, p.method, p.external_ref, p.status
    FROM subscription_payments p LEFT JOIN plans pl ON pl.id = p.plan_id
    WHERE p.tenant_id = $1 AND p.status <> 'voided' ORDER BY p.paid_at DESC LIMIT 100`, [tenantId]);
  return q.rows;
}

/** Revenue collected in the current IST month (net of tax and refunds), in paise */
async function revenueThisMonth() {
  const start = monthStart(todayIST());
  const q = await pool.query(`
    SELECT COALESCE(SUM(net_paise - refunded_paise), 0)::bigint AS total
    FROM subscription_payments
    WHERE status IN ('captured', 'partially_refunded', 'refunded')
      AND paid_at >= ($1::date AT TIME ZONE 'Asia/Kolkata')
      AND paid_at < (($1::date + INTERVAL '1 month') AT TIME ZONE 'Asia/Kolkata')`, [start]);
  return Number(q.rows[0].total);
}

module.exports = {
  BillingError, METHODS, TYPES, listPlans, planExists, updatePlan,
  validatePaymentInput, recordPayment, refundPayment, voidPayment, listPayments, listOwnPayments, revenueThisMonth
};

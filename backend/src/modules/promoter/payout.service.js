/**
 * Payouts: monthly drafts → approved → paid (with UTR). Failed or cancelled payouts release their
 * entries back to "available" so they are picked up by the next run.
 */
const pool = require('../../config/database');
const settingsService = require('./settings.service');
const { logPromoterAudit } = require('./promoter.audit');
const { emails } = require('./promoter.email');
const { decrypt } = require('../../utils/secretBox');
const { httpError } = require('../../utils/route');
const { addMonths, monthStart, todayIST, financialYearStart, mulDivFloor, isValidDateString, addDays } = require('../../utils/money');

/**
 * TDS for a payout. Below the yearly threshold nothing is deducted. Once the promoter's commission in
 * the financial year exceeds it, the TDS due on the whole year so far is calculated and the TDS
 * already deducted this year is subtracted — so earlier untaxed payouts are caught up exactly once.
 */
function computeTds({ grossPaise, previousFyGross, previousFyTds, hasPan, settings }) {
  const rate = hasPan ? settings.tds_rate_bps : settings.tds_rate_no_pan_bps;
  if (rate <= 0) return { tds: 0, rate, catchUp: 0 };
  if (previousFyGross + grossPaise <= settings.tds_threshold_paise) return { tds: 0, rate: 0, catchUp: 0 };
  const dueForYear = mulDivFloor(previousFyGross + grossPaise, rate, 10000);
  const tds = Math.max(0, Math.min(grossPaise, dueForYear - previousFyTds));
  const onThisPayout = mulDivFloor(grossPaise, rate, 10000);
  return { tds, rate, catchUp: Math.max(0, tds - onThisPayout) };
}

// Never send the encrypted account number to a client
function strip(row) {
  if (!row) return row;
  const { dest_bank_account_enc, ...rest } = row;
  return rest;
}

function destinationOf(p) {
  if (p.payout_method === 'upi') return `UPI ${p.upi_id}`;
  if (p.payout_method === 'bank') return `Bank ****${p.bank_account_last4} (${p.bank_ifsc})`;
  return null;
}

/**
 * Creates draft payouts for `periodMonth` (YYYY-MM-01): commissions that became available before the
 * first day of the following month. Safe to run twice (one payout per promoter and month).
 */
async function runPayouts({ periodMonth, promoterIds = null } = {}, actor = { actorType: 'system' }) {
  const period = periodMonth || addMonths(monthStart(todayIST()), -1);
  if (!isValidDateString(period) || !period.endsWith('-01')) throw httpError('periodMonth must be the first day of a month (YYYY-MM-01)', 400);
  const cutoffDate = addMonths(period, 1);
  if (cutoffDate > todayIST()) throw httpError('This month has not ended yet', 400);

  const client = await pool.connect();
  const created = [];
  const skipped = [];
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('promoter_payout_run'))`);
    const settingsRow = await settingsService.getCurrent(client);
    const settings = settingsRow.settings;

    const params = [];
    let filter = '';
    if (Array.isArray(promoterIds) && promoterIds.length) { params.push(promoterIds); filter = `AND p.id = ANY($1)`; }
    const promoters = await client.query(`SELECT p.* FROM promoters p WHERE p.status IN ('active', 'suspended', 'terminated') ${filter} ORDER BY p.name`, params);

    for (const p of promoters.rows) {
      const why = (reason) => skipped.push({ promoter_id: p.id, name: p.name, reason });
      if (p.status === 'suspended' && settings.suspended_promoter_policy !== 'continue') { why('Suspended'); continue; }
      if (p.status === 'terminated' && settings.terminated_promoter_policy !== 'pay_out') { why('Terminated'); continue; }
      const existing = await client.query(
        `SELECT 1 FROM promoter_payouts WHERE promoter_id = $1 AND period_month = $2 AND status NOT IN ('cancelled', 'failed')`, [p.id, period]);
      if (existing.rows.length) { why('Payout for this month already exists'); continue; }

      const entries = await client.query(`
        SELECT id, amount_paise FROM promoter_commissions
        WHERE promoter_id = $1 AND status = 'available' AND payout_id IS NULL
          AND available_at < ($2::date AT TIME ZONE 'Asia/Kolkata')
        FOR UPDATE`, [p.id, cutoffDate]);
      const gross = entries.rows.reduce((s, e) => s + Number(e.amount_paise), 0);
      if (!entries.rows.length || gross === 0) continue; // nothing to pay, not worth listing
      const min = p.override_min_payout_paise != null ? Number(p.override_min_payout_paise) : settings.min_payout_paise;
      if (gross < 0) { why(`Balance is negative (₹${(gross / 100).toFixed(2)}), carried forward`); continue; }
      if (gross < min) { why(`Balance ₹${(gross / 100).toFixed(2)} is below the minimum ₹${(min / 100).toFixed(2)}`); continue; }
      if (settings.kyc_required_for_payout && p.kyc_status !== 'verified') { why('KYC not verified'); continue; }
      if (!p.payout_method) { why('No payout details'); continue; }

      const fyStart = financialYearStart(addDays(cutoffDate, -1));
      const fy = await client.query(`
        SELECT COALESCE(SUM(gross_paise), 0)::bigint AS gross,
               COALESCE(SUM(tds_paise), 0)::bigint AS tds
        FROM promoter_payouts WHERE promoter_id = $1 AND status NOT IN ('cancelled', 'failed') AND period_month >= $2`, [p.id, fyStart]);
      const tax = computeTds({
        grossPaise: gross, previousFyGross: Number(fy.rows[0].gross), previousFyTds: Number(fy.rows[0].tds),
        hasPan: !!p.pan, settings
      });
      const gstRate = p.gstin ? settings.gst_on_commission_bps : 0;
      const gst = gstRate ? mulDivFloor(gross, gstRate, 10000) : 0;

      const ins = await client.query(`
        INSERT INTO promoter_payouts (promoter_id, period_month, gross_paise, gst_paise, tds_paise, tds_rate_bps, gst_rate_bps,
          status, payout_method, payout_destination, settings_version_id, notes, created_by,
          dest_upi_id, dest_bank_account_enc, dest_bank_ifsc, dest_bank_holder, dest_pan, dest_gstin)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *`,
      [p.id, period, gross, gst, tax.tds, tax.rate, gstRate, p.payout_method, destinationOf(p), settingsRow.id,
        tax.catchUp ? `TDS includes ₹${(tax.catchUp / 100).toFixed(2)} catch-up for earlier payouts this financial year` : null,
        actor?.actorType === 'staff' ? actor.actorId : null,
        p.payout_method === 'upi' ? p.upi_id : null, p.payout_method === 'bank' ? p.bank_account_enc : null,
        p.payout_method === 'bank' ? p.bank_ifsc : null, p.payout_method === 'bank' ? p.bank_holder_name : null, p.pan, p.gstin]);
      await client.query(`UPDATE promoter_commissions SET payout_id = $1 WHERE id = ANY($2)`, [ins.rows[0].id, entries.rows.map(e => e.id)]);
      created.push({ ...strip(ins.rows[0]), promoter_name: p.name, entry_count: entries.rows.length });
    }
    await logPromoterAudit(client, {
      ...actor, action: 'payout.run', after: { period_month: period, created: created.length, skipped: skipped.length }
    });
    await client.query('COMMIT');
    return { period_month: period, created, skipped };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function transition(id, action, body, actor) {
  const client = await pool.connect();
  let payout;
  let promoter;
  try {
    await client.query('BEGIN');
    const q = await client.query(`SELECT * FROM promoter_payouts WHERE id = $1 FOR UPDATE`, [id]);
    const before = q.rows[0];
    if (!before) throw httpError('Payout not found', 404);
    const reason = body?.reason ? String(body.reason).trim() : null;

    if (action === 'approve') {
      if (before.status !== 'draft') throw httpError(`Only draft payouts can be approved (this one is ${before.status})`, 400);
      const settings = (await settingsService.getCurrent(client)).settings;
      const pk = await client.query(`SELECT kyc_status FROM promoters WHERE id = $1`, [before.promoter_id]);
      if (settings.kyc_required_for_payout && pk.rows[0].kyc_status !== 'verified') {
        throw httpError('The promoter changed their payout details after this draft was created. Verify KYC, then cancel this draft and run payouts again.', 409);
      }
      const tds = body?.tds_paise;
      if (tds !== undefined && !(Number.isInteger(tds) && tds >= 0 && tds <= Number(before.gross_paise))) throw httpError('Invalid TDS amount', 400);
      const up = await client.query(`
        UPDATE promoter_payouts SET status = 'approved', approved_by = $2, approved_at = now(),
          tds_paise = COALESCE($3, tds_paise), updated_at = now() WHERE id = $1 RETURNING *`,
      [id, actor.actorId, tds ?? null]);
      payout = up.rows[0];
    } else if (action === 'mark_paid') {
      if (before.status !== 'approved') throw httpError('Only approved payouts can be marked paid', 400);
      const utr = String(body?.utr || '').trim();
      if (utr.length < 4 || utr.length > 100) throw httpError('Enter the bank / UPI reference (UTR)', 400);
      const paidAt = body?.paid_at ? new Date(body.paid_at) : new Date();
      if (isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 600000) throw httpError('Invalid payment date', 400);
      const up = await client.query(`
        UPDATE promoter_payouts SET status = 'paid', utr = $2, paid_at = $3, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, utr, paidAt]);
      payout = up.rows[0];
      await client.query(`UPDATE promoter_commissions SET status = 'paid' WHERE payout_id = $1 AND status = 'available'`, [id]);
    } else if (action === 'mark_failed' || action === 'cancel') {
      const allowed = action === 'cancel' ? ['draft', 'approved'] : ['approved'];
      if (!allowed.includes(before.status)) throw httpError(`Cannot ${action === 'cancel' ? 'cancel' : 'fail'} a ${before.status} payout`, 400);
      if (!reason) throw httpError('A reason is required', 400);
      const up = await client.query(`
        UPDATE promoter_payouts SET status = $2, notes = CONCAT_WS(E'\\n', notes, $3::text), updated_at = now() WHERE id = $1 RETURNING *`,
      [id, action === 'cancel' ? 'cancelled' : 'failed', `${action === 'cancel' ? 'Cancelled' : 'Failed'}: ${reason}`]);
      payout = up.rows[0];
      await client.query(`UPDATE promoter_commissions SET payout_id = NULL WHERE payout_id = $1 AND status = 'available'`, [id]);
    } else {
      throw httpError('Unknown action', 400);
    }
    await logPromoterAudit(client, {
      ...actor, action: `payout.${action}`, promoterId: before.promoter_id, entityType: 'promoter_payout', entityId: id,
      before: { status: before.status }, after: { status: payout.status, utr: payout.utr, tds_paise: payout.tds_paise }, reason
    });
    const pq = await client.query(`SELECT id, name, email FROM promoters WHERE id = $1`, [before.promoter_id]);
    promoter = pq.rows[0];
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (action === 'mark_paid') {
    const settings = (await settingsService.getCurrent()).settings;
    if (settings.email_on_payout_paid) emails.payoutPaid(promoter, payout);
  }
  return strip(payout);
}

async function list({ status, periodMonth, promoterId } = {}) {
  const params = [];
  const where = [];
  if (status && status !== 'all') { params.push(status); where.push(`po.status = $${params.length}`); }
  if (periodMonth) { params.push(periodMonth); where.push(`po.period_month = $${params.length}`); }
  if (promoterId) { params.push(promoterId); where.push(`po.promoter_id = $${params.length}`); }
  const q = await pool.query(`
    SELECT po.*, po.period_month::text AS period_month, p.name AS promoter_name, p.code AS promoter_code, p.kyc_status,
      (SELECT COUNT(*) FROM promoter_commissions c WHERE c.payout_id = po.id)::int AS entry_count
    FROM promoter_payouts po JOIN promoters p ON p.id = po.promoter_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY po.period_month DESC, p.name LIMIT 500`, params);
  return q.rows.map(strip);
}

async function getWithEntries(id, { promoterId = null } = {}) {
  const q = await pool.query(`
    SELECT po.*, po.period_month::text AS period_month, p.name AS promoter_name, p.code AS promoter_code, p.email AS promoter_email,
      po.dest_pan AS pan, po.dest_gstin AS gstin FROM promoter_payouts po JOIN promoters p ON p.id = po.promoter_id
    WHERE po.id = $1 ${promoterId ? 'AND po.promoter_id = $2' : ''}`, promoterId ? [id, promoterId] : [id]);
  if (!q.rows.length) throw httpError('Payout not found', 404);
  const entries = await pool.query(`
    SELECT c.id, c.entry_type, c.tenant_name, c.amount_paise, c.rate_bps, c.base_paise, c.eligible_days, c.period_days, c.note,
      c.created_at, p.period_start::text AS period_start, p.period_end::text AS period_end
    FROM promoter_commissions c LEFT JOIN subscription_payments p ON p.id = c.payment_id
    WHERE c.payout_id = $1 ORDER BY c.created_at`, [id]);
  return { payout: strip(q.rows[0]), entries: entries.rows };
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  // Neutralise spreadsheet formulas and quote everything
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** CSV of approved payouts for bank / UPI bulk transfer. Contains full account numbers: super admin only. */
async function exportCsv({ status = 'approved', periodMonth } = {}, actor) {
  const params = [status];
  let filter = '';
  if (periodMonth) { params.push(periodMonth); filter = 'AND po.period_month = $2'; }
  const q = await pool.query(`
    SELECT po.id, po.period_month::text AS period_month, po.net_paise, po.gross_paise, po.gst_paise, po.tds_paise, po.payout_method,
      p.name, p.email, p.phone, po.dest_pan AS pan, po.dest_upi_id AS upi_id, po.dest_bank_account_enc AS bank_account_enc,
      po.dest_bank_ifsc AS bank_ifsc, po.dest_bank_holder AS bank_holder_name, p.code
    FROM promoter_payouts po JOIN promoters p ON p.id = po.promoter_id
    WHERE po.status = $1 ${filter} ORDER BY p.name`, params);
  const header = ['payout_id', 'period_month', 'promoter', 'code', 'email', 'phone', 'pan', 'method', 'upi_id', 'account_holder', 'account_number', 'ifsc', 'commission', 'gst', 'tds', 'amount_to_pay'];
  const lines = [header.map(csvCell).join(',')];
  for (const r of q.rows) {
    let account = '';
    if (r.bank_account_enc) {
      try { account = decrypt(r.bank_account_enc); } catch { account = 'DECRYPT_FAILED'; }
    }
    lines.push([r.id, r.period_month, r.name, r.code, r.email, r.phone, r.pan, r.payout_method, r.upi_id, r.bank_holder_name,
      account, r.bank_ifsc, (r.gross_paise / 100).toFixed(2), (r.gst_paise / 100).toFixed(2), (r.tds_paise / 100).toFixed(2),
      (r.net_paise / 100).toFixed(2)].map(csvCell).join(','));
  }
  await logPromoterAudit(null, { ...actor, action: 'payout.export_csv', after: { status, period_month: periodMonth || null, rows: q.rows.length } });
  return lines.join('\r\n') + '\r\n';
}

/** PDF statement for one payout */
async function statementPdf(id, { promoterId = null } = {}) {
  const { payout, entries } = await getWithEntries(id, { promoterId });
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const rs = (p) => `Rs. ${(Number(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  doc.fontSize(18).text('ReceptionAI — Partner payout statement');
  doc.moveDown(0.5).fontSize(10).fillColor('#555')
    .text(`Partner: ${payout.promoter_name} (${payout.promoter_code})`)
    .text(`Period: ${payout.period_month.slice(0, 7)}    Status: ${payout.status}${payout.utr ? `    Reference: ${payout.utr}` : ''}`)
    .text(`PAN: ${payout.pan ? payout.pan.slice(0, 5) + '****' + payout.pan.slice(-1) : 'not provided'}${payout.gstin ? `    GSTIN: ${payout.gstin}` : ''}`);
  doc.moveDown().fillColor('#000').fontSize(11);
  doc.text(`Commission: ${rs(payout.gross_paise)}`);
  if (Number(payout.gst_paise)) doc.text(`GST (${(payout.gst_rate_bps / 100).toFixed(2)}%): ${rs(payout.gst_paise)}`);
  doc.text(`TDS${payout.tds_rate_bps ? ` (${(payout.tds_rate_bps / 100).toFixed(2)}%)` : ''}: -${rs(payout.tds_paise)}`);
  doc.font('Helvetica-Bold').text(`Amount paid: ${rs(payout.net_paise)}`).font('Helvetica');
  if (payout.notes) doc.moveDown(0.5).fontSize(9).fillColor('#555').text(payout.notes).fillColor('#000');
  doc.moveDown().fontSize(12).text('Details');
  doc.moveDown(0.3).fontSize(9);
  for (const e of entries) {
    const label = e.entry_type === 'commission'
      ? `${e.tenant_name} — ${e.period_start} to ${e.period_end} — ${(e.rate_bps / 100).toFixed(2)}% of ${rs(e.base_paise)}${e.eligible_days !== e.period_days ? ` (${e.eligible_days}/${e.period_days} days)` : ''}`
      : `${e.entry_type}${e.tenant_name ? ` — ${e.tenant_name}` : ''}${e.note ? ` — ${e.note}` : ''}`;
    doc.text(`${label}:  ${rs(e.amount_paise)}`);
  }
  doc.end();
  return { buffer: await done, filename: `payout-${payout.promoter_code}-${payout.period_month.slice(0, 7)}.pdf` };
}

module.exports = { computeTds, runPayouts, transition, list, getWithEntries, exportCsv, statementPdf };

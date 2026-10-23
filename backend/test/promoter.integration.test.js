/**
 * End-to-end tests of billing + the promoter program through the HTTP API, against a real Postgres.
 *
 *   TEST_DATABASE_URL=postgresql://user@localhost:5432/receptionai_test npm run test:integration
 *
 * The database must already be migrated (npm run migrate with DATABASE_URL pointing at it).
 * The test WIPES all promoter/billing tables in that database. It refuses to run unless the
 * database name contains "test". Redis must be running (the server needs it).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const DB = process.env.TEST_DATABASE_URL;
const PORT = process.env.TEST_PORT || '3999';
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

if (!DB) {
  test('integration tests (skipped: TEST_DATABASE_URL not set)', { skip: true }, () => {});
  return;
}
if (!/test/i.test(new URL(DB).pathname)) throw new Error('TEST_DATABASE_URL must point at a database whose name contains "test"');

const pool = new Pool({ connectionString: DB });
let server;
let ipCounter = 1;
const nextIp = () => `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

async function api(method, url, { token, body, raw } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': nextIp(), // a fresh client IP per call so the strict auth rate limiter does not trip
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (raw) return res;
  const json = await res.json().catch(() => null);
  return { status: res.status, ...(json || {}) };
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

const S = {}; // shared state across the ordered tests

test.before(async () => {
  await pool.query(`TRUNCATE promoter_commissions, promoter_payouts, referral_terms, tenant_referrals, promoter_sessions,
    promoter_password_resets, promoters, subscription_payments, promoter_audit_logs CASCADE`);
  await pool.query(`DELETE FROM promoter_program_settings WHERE version > 1`);
  await pool.query(`UPDATE commission_schemes SET current_version_id = '00000000-0000-4000-8000-000000000002' WHERE id = '00000000-0000-4000-8000-000000000001'`);
  await pool.query(`DELETE FROM commission_scheme_versions WHERE id <> '00000000-0000-4000-8000-000000000002'`);
  await pool.query(`DELETE FROM commission_schemes WHERE id <> '00000000-0000-4000-8000-000000000001'`);
  await pool.query(`UPDATE plans SET monthly_price_paise = CASE id WHEN 'starter' THEN 299900 WHEN 'growth' THEN 599900 ELSE 999900 END, is_active = true`);
  await pool.query(`DELETE FROM tenants WHERE slug LIKE 'itest%'`);

  // Super admin on its own platform tenant
  const t = await pool.query(`INSERT INTO tenants (name, slug, industry, plan, status) VALUES ('Platform', 'itest-platform', 'clinic', 'pro', 'active') RETURNING id`);
  const email = `sa-${crypto.randomBytes(4).toString('hex')}@itest.local`;
  await pool.query(`INSERT INTO staff (tenant_id, name, email, role, is_active, password_hash, email_verified) VALUES ($1, 'Super Admin', $2, 'super_admin', true, $3, true)`,
    [t.rows[0].id, email, await bcrypt.hash('Passw0rd!', 4)]);

  server = spawn(process.execPath, [path.join(__dirname, '../src/index.js')], {
    env: { ...process.env, DATABASE_URL: DB, PORT, NODE_ENV: 'test', BYPASS_AUTH: 'false' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  const login = await api('POST', '/auth/login', { body: { email, password: 'Passw0rd!' } });
  assert.equal(login.status, 200, JSON.stringify(login));
  S.admin = login.data.token;
});

test.after(async () => {
  if (server) server.kill();
  await pool.end();
});

async function settings() {
  return (await api('GET', '/superadmin/promoter-program/settings', { token: S.admin })).data;
}
async function saveSettings(changes, reason = 'test') {
  const cur = await settings();
  const r = await api('PUT', '/superadmin/promoter-program/settings', { token: S.admin, body: { changes, baseVersion: cur.version, reason } });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.data;
}

test('settings: schema, validation, reason, optimistic locking, history', async () => {
  const schema = await api('GET', '/superadmin/promoter-program/settings/schema', { token: S.admin });
  assert.ok(schema.data.fields.find(f => f.key === 'hold_days'));
  const cur = await settings();
  assert.equal(cur.version, 1);

  let r = await api('PUT', '/superadmin/promoter-program/settings', { token: S.admin, body: { changes: { hold_days: 999 }, baseVersion: 1, reason: 'x' } });
  assert.equal(r.status, 400);
  assert.ok(r.details.hold_days);
  r = await api('PUT', '/superadmin/promoter-program/settings', { token: S.admin, body: { changes: { hold_days: 10 }, baseVersion: 1 } });
  assert.equal(r.status, 400);
  r = await api('PUT', '/superadmin/promoter-program/settings', { token: S.admin, body: { changes: { program_enabled: true, hold_days: 30 }, baseVersion: 1, reason: 'Launch' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.version, 2);
  r = await api('PUT', '/superadmin/promoter-program/settings', { token: S.admin, body: { changes: { hold_days: 20 }, baseVersion: 1, reason: 'stale' } });
  assert.equal(r.status, 409);
  const preview = await api('POST', '/superadmin/promoter-program/settings/preview', { token: S.admin, body: { changes: { hold_days: 5 } } });
  assert.ok(preview.data.notes.length >= 1);
  const hist = await api('GET', '/superadmin/promoter-program/settings/history', { token: S.admin });
  assert.equal(hist.data.length, 2);
});

test('promoter apply → approve → login; tokens are not interchangeable', async () => {
  const body = { name: 'Rahul Kumar', email: 'rahul@itest.local', phone: '9876500001', city: 'Kochi', password: 'partnerpass', agreement_accepted: true };
  let r = await api('POST', '/partner/apply', { body });
  assert.equal(r.status, 201, JSON.stringify(r));
  assert.equal(r.data.status, 'pending');
  r = await api('POST', '/partner/apply', { body });
  assert.equal(r.status, 409);
  r = await api('POST', '/partner/login', { body: { email: body.email, password: body.password } });
  assert.equal(r.status, 403);

  const list = await api('GET', '/superadmin/promoter-program/promoters?status=pending', { token: S.admin });
  S.promoterA = list.data[0];
  r = await api('POST', `/superadmin/promoter-program/promoters/${S.promoterA.id}/approve`, { token: S.admin, body: {} });
  assert.equal(r.status, 200);

  r = await api('POST', '/partner/login', { body: { email: body.email, password: 'wrong' } });
  assert.equal(r.status, 401);
  r = await api('POST', '/partner/login', { body: { email: 'RAHUL@itest.local', password: body.password } });
  assert.equal(r.status, 200);
  S.tokenA = r.data.token;
  S.codeA = r.data.promoter.code;
  assert.match(S.codeA, /^[A-Z2-9]{8}$/);
  assert.ok(!('password_hash' in r.data.promoter));

  assert.equal((await api('GET', '/partner/me', { token: S.admin })).status, 401, 'staff token on partner API');
  assert.equal((await api('GET', '/bookings', { token: S.tokenA })).status, 401, 'partner token on staff API');
  assert.equal((await api('GET', '/superadmin/promoter-program/overview', { token: S.tokenA })).status, 401);

  const v = await api('GET', `/partner/code/${S.codeA.toLowerCase()}`);
  assert.deepEqual(v.data, { valid: true, code: S.codeA, promoterName: 'Rahul' });
  assert.equal((await api('GET', '/partner/code/ZZZZZZZZ')).data.valid, false);
});

async function signupClinic(slugSuffix, { code, email, phone, whatsapp, source = 'link' }) {
  const r = await api('POST', '/onboarding/clinic', {
    body: {
      clinicName: `itest-${slugSuffix}`, ownerName: 'Dr Owner', email, phone, whatsappNumber: whatsapp,
      plan: 'growth', password: 'clinicpass1', referralCode: code, referralSource: source
    }
  });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.data.tenant_id;
}

test('clinic sign-up with referral code; self-referral flagged; unknown code ignored', async () => {
  S.clinic1 = await signupClinic('one', { code: ` ${S.codeA.toLowerCase()} `, email: 'c1@itest.local', phone: '9000000001', whatsapp: '9000000101' });
  let ref = await api('GET', `/superadmin/promoter-program/tenants/${S.clinic1}/referral`, { token: S.admin });
  assert.equal(ref.data.referral.status, 'active');
  assert.equal(ref.data.referral.source, 'signup_link');
  assert.equal(ref.data.terms.length, 1);
  assert.equal(ref.data.terms[0].base_rate_bps, 2000);

  S.clinicSelf = await signupClinic('self', { code: S.codeA, email: 'rahul@itest.local', phone: '9000000002', whatsapp: '9000000102' });
  ref = await api('GET', `/superadmin/promoter-program/tenants/${S.clinicSelf}/referral`, { token: S.admin });
  assert.equal(ref.data.referral.status, 'flagged');

  const none = await signupClinic('nocode', { code: 'NOPE1234', email: 'c3@itest.local', phone: '9000000003', whatsapp: '9000000103' });
  ref = await api('GET', `/superadmin/promoter-program/tenants/${none}/referral`, { token: S.admin });
  assert.equal(ref.data.referral, null);
  S.clinicNoRef = none;

  const clinics = await api('GET', '/partner/clinics', { token: S.tokenA });
  assert.equal(clinics.data.length, 2);
  assert.ok(clinics.data.some(c => c.referral_status === 'under_review'));
  assert.ok(!JSON.stringify(clinics.data).includes('c1@itest.local'), 'no clinic contact data for promoters');
});

test('payments: validation, commission accrual, duplicates, refunds, void', async () => {
  const base = { gross_paise: 599900, period_start: '2026-08-15', period_end: '2026-09-14', paid_at: daysAgo(70), method: 'upi', external_ref: 'UTR-001' };
  let r = await api('POST', `/superadmin/billing/tenants/${S.clinic1}/payments`, { token: S.admin, body: { ...base, external_ref: '' } });
  assert.equal(r.status, 400);
  assert.ok(r.details.external_ref);
  r = await api('POST', `/superadmin/billing/tenants/${S.clinic1}/payments`, { token: S.admin, body: { ...base, period_end: '2026-08-01' } });
  assert.equal(r.status, 400);

  r = await api('POST', `/superadmin/billing/tenants/${S.clinic1}/payments`, { token: S.admin, body: base });
  assert.equal(r.status, 201, JSON.stringify(r));
  assert.equal(Number(r.data.commission.amount_paise), 119980);
  assert.equal(r.data.commission.status, 'pending');
  S.pay1 = r.data.payment.id;

  r = await api('POST', `/superadmin/billing/tenants/${S.clinic1}/payments`, { token: S.admin, body: base });
  assert.equal(r.status, 409);

  // Second payment: partial refund then full refund (unpaid → void)
  r = await api('POST', `/superadmin/billing/tenants/${S.clinic1}/payments`, { token: S.admin, body: { ...base, external_ref: 'UTR-002', period_start: '2026-09-15', period_end: '2026-10-14', paid_at: daysAgo(40) } });
  S.pay2 = r.data.payment.id;
  assert.equal(Number(r.data.commission.amount_paise), 119980);
  r = await api('POST', `/superadmin/billing/payments/${S.pay2}/refund`, { token: S.admin, body: { amount_paise: 299950, reason: 'Half refund' } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.data.commissionEffects[0].amount_paise, -59990);
  r = await api('POST', `/superadmin/billing/payments/${S.pay2}/refund`, { token: S.admin, body: { amount_paise: 999999, reason: 'too much' } });
  assert.equal(r.status, 400);
  r = await api('POST', `/superadmin/billing/payments/${S.pay2}/refund`, { token: S.admin, body: { amount_paise: 299950, reason: 'Rest' } });
  assert.equal(r.data.payment.status, 'refunded');
  assert.equal(r.data.commissionEffects[0].action, 'voided');

  // Non-subscription payments earn nothing (settings: commissionable payment types)
  r = await api('POST', `/superadmin/billing/tenants/${S.clinic1}/payments`, { token: S.admin, body: { ...base, external_ref: 'UTR-SETUP', payment_type: 'setup_fee' } });
  assert.equal(r.data.commission, null);
  assert.equal(r.data.commissionSkipped, 'payment_type_not_commissionable');

  // Unreferred clinic: no commission
  r = await api('POST', `/superadmin/billing/tenants/${S.clinicNoRef}/payments`, { token: S.admin, body: { ...base, external_ref: 'UTR-NOREF' } });
  assert.equal(r.data.commissionSkipped, 'no_referral');

  const stats = await api('GET', '/superadmin/stats', { token: S.admin });
  assert.equal(stats.status, 200);
});

test('ledger is append-only at the database level', async () => {
  await assert.rejects(pool.query(`UPDATE promoter_commissions SET amount_paise = amount_paise + 1`), /immutable/);
  await assert.rejects(pool.query(`DELETE FROM promoter_commissions`), /append-only/);
});

test('release job: hold period, flagged referrals wait', async () => {
  // Payment for the self-referral (flagged) clinic
  let r = await api('POST', `/superadmin/billing/tenants/${S.clinicSelf}/payments`, { token: S.admin, body: { gross_paise: 299900, period_start: '2026-08-01', period_end: '2026-08-31', paid_at: daysAgo(80), method: 'cash', plan_id: 'starter' } });
  assert.equal(r.status, 201);
  r = await api('POST', '/superadmin/promoter-program/jobs/release', { token: S.admin });
  assert.equal(r.status, 200, JSON.stringify(r));
  const ledger = await api('GET', `/superadmin/promoter-program/ledger?promoterId=${S.promoterA.id}`, { token: S.admin });
  const byPayment = (id) => ledger.data.find(e => e.payment_id === id && e.entry_type === 'commission');
  assert.equal(byPayment(S.pay1).status, 'available');
  const flagged = ledger.data.find(e => e.tenant_id === S.clinicSelf);
  assert.equal(flagged.status, 'pending');
  const sum = await api('GET', '/partner/dashboard/summary', { token: S.tokenA });
  assert.equal(sum.data.available_paise, 119980);
});

test('scheme change applied to existing referrals from a date; terms cannot go back before accrued periods', async () => {
  const schemes = await api('GET', '/superadmin/promoter-program/schemes', { token: S.admin });
  const std = schemes.data[0];
  const values = { base_rate_bps: 2500, commission_months: 12, tier_mode: 'locked', plan_rates: {}, tiers: [] };
  let r = await api('PUT', `/superadmin/promoter-program/schemes/${std.id}`, { token: S.admin, body: { values: { ...values, base_rate_bps: 9000 }, reason: 'x', baseVersion: 1 } });
  assert.equal(r.status, 400);
  r = await api('PUT', `/superadmin/promoter-program/schemes/${std.id}`, { token: S.admin, body: { values, reason: 'Raise to 25%', baseVersion: 1, applyTo: 'existing', effectiveFrom: '2026-09-01' } });
  assert.equal(r.status, 400, 'before an accrued period start');
  r = await api('PUT', `/superadmin/promoter-program/schemes/${std.id}`, { token: S.admin, body: { values, reason: 'Raise to 25%', baseVersion: 1, applyTo: 'existing', effectiveFrom: '2026-10-15' } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.data.affectedReferrals, 2);

  r = await api('POST', `/superadmin/billing/tenants/${S.clinic1}/payments`, { token: S.admin, body: { gross_paise: 599900, period_start: '2026-10-15', period_end: '2026-11-13', paid_at: daysAgo(5), method: 'upi', external_ref: 'UTR-003' } });
  assert.equal(Number(r.data.commission.amount_paise), 149975);
  // Old entries unchanged
  const ledger = await api('GET', `/superadmin/promoter-program/ledger?promoterId=${S.promoterA.id}`, { token: S.admin });
  assert.equal(Number(ledger.data.find(e => e.payment_id === S.pay1 && e.entry_type === 'commission').amount_paise), 119980);
});

test('payouts: KYC gate, draft, approve, paid, statement, CSV, IDOR', async () => {
  const period = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 8) + '01'; })();
  // pay1 became available ~40 days ago; make sure it is before the cutoff (first day of this month)
  let r = await api('POST', '/superadmin/promoter-program/payouts/run', { token: S.admin, body: { period_month: period } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.data.created.length, 0);
  assert.match(r.data.skipped[0].reason, /KYC/);

  r = await api('PUT', '/partner/me/payout-details', { token: S.tokenA, body: { pan: 'abcde1234f', payout_method: 'bank', bank_account: '123456789012', bank_ifsc: 'HDFC0001234', bank_holder_name: 'Rahul Kumar' } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.data.pan, 'ABCDE****F');
  assert.ok(!JSON.stringify(r.data).includes('123456789012'));
  r = await api('POST', `/superadmin/promoter-program/promoters/${S.promoterA.id}/kyc`, { token: S.admin, body: { decision: 'verified' } });
  assert.equal(r.status, 200);

  r = await api('POST', '/superadmin/promoter-program/payouts/run', { token: S.admin, body: { period_month: period } });
  assert.equal(r.data.created.length, 1, JSON.stringify(r.data));
  const payout = r.data.created[0];
  assert.equal(Number(payout.gross_paise), 119980);
  assert.equal(Number(payout.tds_paise), 0, 'below yearly TDS threshold');
  r = await api('POST', '/superadmin/promoter-program/payouts/run', { token: S.admin, body: { period_month: period } });
  assert.equal(r.data.created.length, 0, 'running twice does not duplicate');

  assert.equal((await api('POST', `/superadmin/promoter-program/payouts/${payout.id}/mark_paid`, { token: S.admin, body: { utr: 'BANKREF1' } })).status, 400);
  assert.equal((await api('POST', `/superadmin/promoter-program/payouts/${payout.id}/approve`, { token: S.admin, body: {} })).status, 200);
  const csv = await api('GET', `/superadmin/promoter-program/payouts/export.csv?period_month=${period}`, { token: S.admin, raw: true });
  const text = await csv.text();
  assert.ok(text.includes('123456789012'), 'CSV has the full account number for the bank upload');
  r = await api('POST', `/superadmin/promoter-program/payouts/${payout.id}/mark_paid`, { token: S.admin, body: { utr: 'BANKREF1' } });
  assert.equal(r.data.status, 'paid');

  const sum = await api('GET', '/partner/dashboard/summary', { token: S.tokenA });
  assert.equal(sum.data.paid_paise, 119980);
  const pdf = await api('GET', `/partner/payouts/${payout.id}/statement.pdf`, { token: S.tokenA, raw: true });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  S.payoutA = payout.id;

  // Second promoter cannot read promoter A's statement
  await api('POST', '/partner/apply', { body: { name: 'Beena', email: 'beena@itest.local', phone: '9876500002', password: 'partnerpass', agreement_accepted: true } });
  const b = (await api('GET', '/superadmin/promoter-program/promoters?q=beena', { token: S.admin })).data[0];
  await api('POST', `/superadmin/promoter-program/promoters/${b.id}/approve`, { token: S.admin, body: {} });
  S.tokenB = (await api('POST', '/partner/login', { body: { email: 'beena@itest.local', password: 'partnerpass' } })).data.token;
  S.promoterB = b;
  assert.equal((await api('GET', `/partner/payouts/${payout.id}/statement.pdf`, { token: S.tokenB, raw: true })).status, 404);
  assert.equal((await api('GET', '/partner/clinics', { token: S.tokenB })).data.length, 0);
});

test('refund after payout claws back from the next payout', async () => {
  const r = await api('POST', `/superadmin/billing/payments/${S.pay1}/refund`, { token: S.admin, body: { amount_paise: 599900, reason: 'Chargeback' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.commissionEffects[0].action, 'reversed');
  assert.equal(r.data.commissionEffects[0].amount_paise, -119980);
  const sum = await api('GET', '/partner/dashboard/summary', { token: S.tokenA });
  assert.equal(sum.data.available_paise, -119980);
});

test('reassignment applies to future payments only; revoke voids unpaid', async () => {
  let r = await api('POST', `/superadmin/promoter-program/tenants/${S.clinic1}/referral`, { token: S.admin, body: { promoter_id: S.promoterB.id, reason: 'Dispute resolved', effective_from: '2026-11-14' } });
  assert.equal(r.status, 200, JSON.stringify(r));
  r = await api('POST', `/superadmin/billing/tenants/${S.clinic1}/payments`, { token: S.admin, body: { gross_paise: 599900, period_start: '2026-11-14', period_end: '2026-12-13', paid_at: daysAgo(1), method: 'upi', external_ref: 'UTR-004' } });
  assert.equal(r.data.commission.promoter_id, S.promoterB.id);
  const ledgerA = await api('GET', `/superadmin/promoter-program/ledger?promoterId=${S.promoterA.id}`, { token: S.admin });
  assert.ok(ledgerA.data.some(e => e.payment_id && e.tenant_id === S.clinic1), 'A keeps earlier entries');

  r = await api('POST', `/superadmin/promoter-program/tenants/${S.clinicSelf}/referral/status`, { token: S.admin, body: { action: 'revoke', reason: 'Self referral confirmed' } });
  assert.equal(r.status, 200);
  const ledger = await api('GET', `/superadmin/promoter-program/ledger?tenantId=${S.clinicSelf}`, { token: S.admin });
  assert.ok(ledger.data.every(e => e.status === 'void'));
});

test('late attribution window and adjustments', async () => {
  let r = await api('POST', `/superadmin/promoter-program/tenants/${S.clinicNoRef}/referral`, { token: S.admin, body: { promoter_id: S.promoterB.id, reason: 'Forgot the code' } });
  assert.equal(r.status, 200);
  await saveSettings({ late_attribution_days: 0 }, 'No more late attribution');
  const t = await signupClinic('late', { email: 'c4@itest.local', phone: '9000000004', whatsapp: '9000000104' });
  r = await api('POST', `/superadmin/promoter-program/tenants/${t}/referral`, { token: S.admin, body: { promoter_id: S.promoterB.id, reason: 'x' } });
  assert.equal(r.status, 400);

  r = await api('POST', '/superadmin/promoter-program/adjustments', { token: S.admin, body: { promoter_id: S.promoterB.id, amount_paise: 50000, note: 'Goodwill' } });
  assert.equal(r.status, 201);
  r = await api('POST', '/superadmin/promoter-program/adjustments', { token: S.admin, body: { promoter_id: S.promoterB.id, amount_paise: 0, note: 'x' } });
  assert.equal(r.status, 400);
});

test('freeze accruals then reconcile; terminate forfeits unpaid', async () => {
  await saveSettings({ freeze_accruals: true }, 'Investigating');
  let r = await api('POST', `/superadmin/billing/tenants/${S.clinicNoRef}/payments`, { token: S.admin, body: { gross_paise: 599900, period_start: '2026-10-20', period_end: '2026-11-19', paid_at: daysAgo(1), method: 'upi', external_ref: 'UTR-005' } });
  assert.equal(r.data.commissionSkipped, 'accruals_frozen');
  await saveSettings({ freeze_accruals: false }, 'Done');
  r = await api('POST', '/superadmin/promoter-program/jobs/release', { token: S.admin });
  assert.ok(r.data.reconciled >= 1, JSON.stringify(r.data));

  r = await api('POST', `/superadmin/promoter-program/promoters/${S.promoterB.id}/terminate`, { token: S.admin, body: { reason: 'Contract ended' } });
  assert.equal(r.status, 200);
  assert.ok(r.data.forfeitedEntries >= 1);
  assert.equal((await api('GET', '/partner/me', { token: S.tokenB })).status, 401, 'sessions removed');
  r = await api('POST', `/superadmin/billing/tenants/${S.clinicNoRef}/payments`, { token: S.admin, body: { gross_paise: 599900, period_start: '2026-11-20', period_end: '2026-12-19', paid_at: daysAgo(0), method: 'upi', external_ref: 'UTR-006' } });
  assert.equal(r.data.commissionSkipped, 'promoter_terminated');
});

test('backdated earlier payment still earns; permanent skips are recorded; revoke keeps money owed back', async () => {
  const t = await signupClinic('backdate', { code: S.codeA, email: 'c5@itest.local', phone: '9000000005', whatsapp: '9000000105' });
  let r = await api('POST', `/superadmin/billing/tenants/${t}/payments`, { token: S.admin, body: { gross_paise: 100000, period_start: '2026-03-01', period_end: '2026-03-31', paid_at: daysAgo(200), method: 'cash' } });
  assert.ok(r.data.commission, JSON.stringify(r.data));
  r = await api('POST', `/superadmin/billing/tenants/${t}/payments`, { token: S.admin, body: { gross_paise: 100000, period_start: '2026-02-01', period_end: '2026-02-28', paid_at: daysAgo(230), method: 'cash' } });
  assert.ok(r.data.commission, 'February recorded after March still earns');
  r = await api('POST', `/superadmin/billing/tenants/${t}/payments`, { token: S.admin, body: { gross_paise: 100000, period_start: '2026-02-01', period_end: '2026-02-28', paid_at: daysAgo(230), method: 'cash' } });
  assert.equal(r.status, 409, 'same cash payment twice asks for confirmation');
  assert.equal(r.details.duplicate, true);

  // Outside the 12-month window → skipped for good (not retried every night)
  r = await api('POST', `/superadmin/billing/tenants/${t}/payments`, { token: S.admin, body: { gross_paise: 100000, period_start: '2027-03-01', period_end: '2027-03-31', paid_at: daysAgo(0), method: 'upi', external_ref: 'UTR-FAR' } });
  assert.equal(r.data.commissionSkipped, 'outside_window');
  const skip = await pool.query(`SELECT commission_skip_reason FROM subscription_payments WHERE id = $1`, [r.data.payment.id]);
  assert.equal(skip.rows[0].commission_skip_reason, 'outside_window');

  // Money owed back (negative adjustment) survives a revoke; earnings are voided
  r = await api('POST', '/superadmin/promoter-program/adjustments', { token: S.admin, body: { promoter_id: S.promoterA.id, tenant_id: t, amount_paise: -5000, note: 'Recover' } });
  assert.equal(r.status, 201);
  r = await api('POST', `/superadmin/promoter-program/tenants/${t}/referral/status`, { token: S.admin, body: { action: 'revoke', reason: 'Fraud' } });
  assert.equal(r.status, 200);
  const ledger = await api('GET', `/superadmin/promoter-program/ledger?tenantId=${t}`, { token: S.admin });
  const adj = ledger.data.find(e => e.entry_type === 'adjustment');
  assert.equal(adj.status, 'available');
  assert.ok(ledger.data.filter(e => e.entry_type === 'commission').every(e => e.status === 'void'));
});

test('agreement version change requires re-acceptance', async () => {
  await saveSettings({ agreement_version: 'v2', agreement_text: '## v2' }, 'New terms');
  let s = await api('GET', '/partner/dashboard/summary', { token: S.tokenA });
  assert.equal(s.data.agreement_current, false);
  let r = await api('POST', '/partner/me/accept-agreement', { token: S.tokenA, body: { version: 'v1' } });
  assert.equal(r.status, 409);
  r = await api('POST', '/partner/me/accept-agreement', { token: S.tokenA, body: { version: 'v2' } });
  assert.equal(r.status, 200);
  s = await api('GET', '/partner/dashboard/summary', { token: S.tokenA });
  assert.equal(s.data.agreement_current, true);
});

test('tenant delete asks for confirmation when unpaid commission exists; ledger survives', async () => {
  await pool.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [S.clinic1]);
  let r = await api('DELETE', `/superadmin/tenants/${S.clinic1}`, { token: S.admin });
  assert.equal(r.status, 409);
  r = await api('DELETE', `/superadmin/tenants/${S.clinic1}?confirm_commissions=1`, { token: S.admin });
  assert.equal(r.status, 200, JSON.stringify(r));
  const q = await pool.query(`SELECT COUNT(*)::int AS n FROM promoter_commissions WHERE tenant_name = 'itest-one'`);
  assert.ok(q.rows[0].n > 0);
  const stmt = await api('GET', `/partner/payouts/${S.payoutA}/statement.pdf`, { token: S.tokenA, raw: true });
  assert.equal(stmt.status, 200);
});

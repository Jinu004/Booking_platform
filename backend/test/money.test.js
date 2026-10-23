// Unit tests for money math, commission calculation, TDS and the settings schema.
// Run: npm test   (no database needed for this file)
process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test';
process.env.PORT = process.env.PORT || '0';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost/unused';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const m = require('../src/utils/money');

test('rupees and paise conversion', () => {
  assert.equal(m.rupeesToPaise('5999'), 599900);
  assert.equal(m.rupeesToPaise('5999.5'), 599950);
  assert.equal(m.rupeesToPaise('0.07'), 7);
  assert.throws(() => m.rupeesToPaise('1.234'));
  assert.throws(() => m.rupeesToPaise('-5'));
  assert.equal(m.paiseToRupeesString(119980), '1199.80');
  assert.equal(m.paiseToRupeesString(-5), '-0.05');
});

test('mulDivFloor floors, also for negatives, without float error', () => {
  assert.equal(m.mulDivFloor(599900, 2000, 10000), 119980);
  assert.equal(m.mulDivFloor(10, 1, 3), 3);
  assert.equal(m.mulDivFloor(-10, 1, 3), -4);
  assert.equal(m.mulDivFloor(9007199254740991, 3, 3), 9007199254740991);
});

test('date helpers', () => {
  assert.equal(m.daysInclusive('2026-11-01', '2026-11-30'), 30);
  assert.equal(m.daysInclusive('2028-02-01', '2028-02-29'), 29);
  assert.equal(m.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(m.windowEnd('2026-11-01', 12), '2027-10-31');
  assert.equal(m.windowEnd('2026-11-01', null), null);
  assert.equal(m.overlapDays('2027-10-15', '2027-11-13', '2026-11-01', '2027-10-31'), 17);
  assert.equal(m.overlapDays('2027-11-01', '2027-11-30', '2026-11-01', '2027-10-31'), 0);
  assert.equal(m.overlapDays('2027-11-01', '2027-11-30', '2026-11-01', null), 30);
  assert.equal(m.financialYearStart('2027-03-31'), '2026-04-01');
  assert.equal(m.financialYearStart('2027-04-01'), '2027-04-01');
  assert.ok(m.isValidDateString('2026-02-28'));
  assert.ok(!m.isValidDateString('2026-02-30'));
  assert.equal(m.todayIST(new Date('2026-10-22T19:00:00Z')), '2026-10-23');
});

const { calculate } = require('../src/modules/promoter/commission.service');
const baseSettings = { exclude_gst: true };
const version = { base_rate_bps: 2000, plan_rates: {}, tiers: [], tier_mode: 'locked', monthly_cap_paise: null };
const terms = { commission_months: 12, override_rate_bps: null, locked_tier_rate_bps: null, locked_tier_index: null };
const pay = (o) => ({ period_start: '2026-11-01', period_end: '2026-11-30', gross_paise: 599900, tax_paise: 0, net_paise: 599900, refunded_paise: 0, plan_id: 'growth', ...o });

test('commission: worked examples from the plan', () => {
  const ws = '2026-11-01';
  assert.equal(calculate({ payment: pay({}), windowStart: ws, terms, version, settings: baseSettings }).amount, 119980);
  assert.equal(calculate({ payment: pay({ period_end: '2027-10-31', gross_paise: 5999000, net_paise: 5999000 }), windowStart: ws, terms, version, settings: baseSettings }).amount, 1199800);
  const straddle = calculate({ payment: pay({ period_start: '2027-10-15', period_end: '2027-11-13' }), windowStart: ws, terms, version, settings: baseSettings });
  assert.equal(straddle.eligibleDays, 17);
  assert.equal(straddle.amount, 67988);
  assert.equal(calculate({ payment: pay({ gross_paise: 707882, tax_paise: 107982, net_paise: 599900 }), windowStart: ws, terms, version, settings: baseSettings }).amount, 119980);
  assert.equal(calculate({ payment: pay({ period_start: '2027-11-01', period_end: '2027-11-30' }), windowStart: ws, terms, version, settings: baseSettings }), null);
});

test('commission: GST included in base when exclude_gst is off', () => {
  const r = calculate({ payment: pay({ gross_paise: 707882, tax_paise: 107982, net_paise: 599900 }), windowStart: '2026-11-01', terms, version, settings: { exclude_gst: false } });
  assert.equal(r.amount, 141576);
});

test('commission: rate precedence override > plan rate > tier > base', () => {
  const ws = '2026-11-01';
  const v = { ...version, plan_rates: { pro: 2500 }, tiers: [{ min_active: 0, rate_bps: 1000 }, { min_active: 5, rate_bps: 3000 }], tier_mode: 'live' };
  assert.deepEqual(pick(calculate({ payment: pay({}), windowStart: ws, terms: { ...terms, override_rate_bps: 4000 }, version: v, settings: baseSettings })), [4000, 'override']);
  assert.deepEqual(pick(calculate({ payment: pay({ plan_id: 'pro' }), windowStart: ws, terms, version: v, settings: baseSettings })), [2500, 'plan_rate']);
  assert.deepEqual(pick(calculate({ payment: pay({}), windowStart: ws, terms, version: v, settings: baseSettings, liveTierIndex: 1 })), [3000, 'tier']);
  const locked = { ...v, tier_mode: 'locked' };
  assert.deepEqual(pick(calculate({ payment: pay({}), windowStart: ws, terms: { ...terms, locked_tier_rate_bps: 1000, locked_tier_index: 0 }, version: locked, settings: baseSettings, liveTierIndex: 1 })), [1000, 'tier']);
  assert.deepEqual(pick(calculate({ payment: pay({}), windowStart: ws, terms, version, settings: baseSettings })), [2000, 'base']);
});
function pick(r) { return [r.rate, r.rateSource]; }

test('commission: monthly cap and lifetime window', () => {
  const r = calculate({ payment: pay({}), windowStart: '2026-11-01', terms, version: { ...version, monthly_cap_paise: 50000 }, settings: baseSettings });
  assert.equal(r.amount, 50000);
  assert.equal(r.capped, true);
  const life = calculate({ payment: pay({ period_start: '2040-01-01', period_end: '2040-01-31' }), windowStart: '2026-11-01', terms: { ...terms, commission_months: null }, version, settings: baseSettings });
  assert.equal(life.eligibleDays, 31);
});

test('commission: refunds reduce the base', () => {
  const r = calculate({ payment: pay({ refunded_paise: 99900 }), windowStart: '2026-11-01', terms, version, settings: baseSettings });
  assert.equal(r.amount, 100000);
});

const { computeTds } = require('../src/modules/promoter/payout.service');
test('TDS threshold, one-time catch-up, no-PAN rate', () => {
  const s = { tds_rate_bps: 200, tds_rate_no_pan_bps: 2000, tds_threshold_paise: 2000000 };
  // April ₹15,000: below the ₹20,000 threshold
  assert.equal(computeTds({ grossPaise: 1500000, previousFyGross: 0, previousFyTds: 0, hasPan: true, settings: s }).tds, 0);
  // May ₹10,000: crosses the threshold → 2% of ₹25,000 = ₹500 (includes ₹300 catch-up)
  const may = computeTds({ grossPaise: 1000000, previousFyGross: 1500000, previousFyTds: 0, hasPan: true, settings: s });
  assert.equal(may.tds, 50000);
  assert.equal(may.catchUp, 30000);
  // June ₹10,000: only 2% of June (the catch-up is not charged again)
  assert.equal(computeTds({ grossPaise: 1000000, previousFyGross: 2500000, previousFyTds: 50000, hasPan: true, settings: s }).tds, 20000);
  assert.equal(computeTds({ grossPaise: 600000, previousFyGross: 2100000, previousFyTds: 420000, hasPan: false, settings: s }).tds, 120000);
});

const schema = require('../src/modules/promoter/settings.schema');
test('settings schema validates types and ranges', () => {
  assert.deepEqual(schema.validate(schema.defaults()).errors, {});
  assert.ok(schema.validate({ ...schema.defaults(), hold_days: -1 }).errors.hold_days);
  assert.ok(schema.validate({ ...schema.defaults(), tds_rate_bps: 1.5 }).errors.tds_rate_bps);
  assert.ok(schema.validate({ ...schema.defaults(), approval_mode: 'yes' }).errors.approval_mode);
  assert.ok(schema.validate({ ...schema.defaults(), payout_methods: [] }).errors.payout_methods);
  assert.ok(schema.validate({ ...schema.defaults(), commissionable_payment_types: ['x'] }).errors.commissionable_payment_types);
  assert.ok(schema.validate({ ...schema.defaults(), nope: 1 }).errors.nope);
  assert.ok(schema.validate({ ...schema.defaults(), code_prefix: 'ab' }).errors.code_prefix);
});

test('settings seed in migration 045 matches the schema defaults', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../database/migrations/045_promoter_config.sql'), 'utf8');
  const json = sql.match(/VALUES \(1, '(\{[\s\S]*?\})'::jsonb/)[1].replace(/''/g, "'");
  assert.deepEqual(JSON.parse(json), schema.defaults());
});

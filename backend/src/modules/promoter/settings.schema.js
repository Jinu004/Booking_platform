/**
 * The single list of promoter program settings: keys, types, limits, defaults, help text and
 * when a change takes effect. The admin Settings screen is generated from this list
 * (GET /superadmin/promoter-program/settings/schema), and every save is validated against it.
 *
 * Adding a setting: add it here (with a default), use it in code. No migration is needed:
 * versions saved before it existed fall back to the default.
 */

const GROUPS = [
  { key: 'general', label: 'General' },
  { key: 'promoters', label: 'Promoters' },
  { key: 'attribution', label: 'Attribution' },
  { key: 'commission', label: 'Commission base' },
  { key: 'hold', label: 'Hold period' },
  { key: 'payouts', label: 'Payouts' },
  { key: 'tax', label: 'Tax' },
  { key: 'policies', label: 'Policies' },
  { key: 'agreement', label: 'Partner agreement' },
  { key: 'notifications', label: 'Notifications' }
];

const PAYMENT_TYPES = ['subscription', 'setup_fee', 'addon', 'other'];

const FIELDS = [
  // General
  { key: 'program_enabled', group: 'general', type: 'boolean', default: false, risky: true,
    label: 'Program enabled',
    help: 'Off hides the partner sign-up and stops capturing referral codes. Existing referrals keep earning unless accruals are frozen.',
    effect: 'Immediately' },
  { key: 'freeze_accruals', group: 'general', type: 'boolean', default: false, risky: true,
    label: 'Freeze commission accruals (emergency switch)',
    help: 'Payments are still recorded but no commission is created. When switched off, the nightly reconciliation creates the missed commissions.',
    effect: 'Immediately' },
  { key: 'default_scheme_id', group: 'general', type: 'scheme', default: '00000000-0000-4000-8000-000000000001',
    label: 'Default commission scheme',
    help: 'Scheme given to newly approved promoters. Can be changed per promoter.',
    effect: 'New promoters only' },

  // Promoters
  { key: 'approval_mode', group: 'promoters', type: 'enum', default: 'manual', options: [
      { value: 'manual', label: 'Manual approval by super admin' },
      { value: 'auto', label: 'Approve automatically' }],
    label: 'Promoter approval', help: 'How partner applications are approved.', effect: 'New applications' },
  { key: 'allow_tenant_promoters', group: 'promoters', type: 'boolean', default: false,
    label: 'Allow existing clinic users to become promoters',
    help: 'Off rejects applications whose email or phone belongs to a clinic user or clinic WhatsApp number.',
    effect: 'New applications' },
  { key: 'kyc_required_for_payout', group: 'promoters', type: 'boolean', default: true,
    label: 'KYC must be verified before payout', help: 'Promoters without verified KYC are skipped in payout runs; their balance carries forward.',
    effect: 'Next payout run' },
  { key: 'code_length', group: 'promoters', type: 'integer', default: 8, min: 6, max: 12,
    label: 'Referral code length', help: 'Characters after the prefix.', effect: 'New codes only' },
  { key: 'code_prefix', group: 'promoters', type: 'text', default: '', pattern: '^[A-Z]{0,4}$', maxLength: 4,
    label: 'Referral code prefix', help: 'Optional, up to 4 capital letters, e.g. RA.', effect: 'New codes only' },

  // Attribution
  { key: 'ref_memory_days', group: 'attribution', type: 'integer', default: 60, min: 1, max: 365,
    label: 'Remember referral link for (days)', help: 'How long a visitor\'s browser keeps the referral code from a link.',
    effect: 'New visitors' },
  { key: 'code_editable', group: 'attribution', type: 'boolean', default: true,
    label: 'Clinic can edit the prefilled referral code', help: 'Off shows the code from the link as read-only on the sign-up form.',
    effect: 'Immediately' },
  { key: 'late_attribution_days', group: 'attribution', type: 'integer', default: 30, min: 0, max: 3650,
    label: 'Late attribution window (days)', help: 'How many days after a clinic signs up a super admin may still attach a promoter to it. 0 = not allowed.',
    effect: 'Immediately' },
  { key: 'reassignment_allowed', group: 'attribution', type: 'boolean', default: true,
    label: 'Allow reassigning a clinic to another promoter', help: 'Reassignment only affects future payments and needs a reason.',
    effect: 'Immediately' },
  { key: 'self_referral_policy', group: 'attribution', type: 'enum', default: 'flag', options: [
      { value: 'flag', label: 'Flag for review (no payout until cleared)' },
      { value: 'block', label: 'Ignore the referral code' },
      { value: 'allow', label: 'Allow' }],
    label: 'Self-referral', help: 'Promoter email or phone matches the clinic owner\'s email, phone or WhatsApp number.',
    effect: 'New sign-ups' },
  { key: 'returning_clinic_policy', group: 'attribution', type: 'enum', default: 'flag', options: [
      { value: 'flag', label: 'Flag for review' },
      { value: 'no_commission', label: 'Attribute, but no commission' },
      { value: 'allow', label: 'Allow' }],
    label: 'Returning clinic', help: 'The owner email, phone or WhatsApp number was already used by another clinic or referral.',
    effect: 'New sign-ups' },

  // Commission base
  { key: 'exclude_gst', group: 'commission', type: 'boolean', default: true,
    label: 'Exclude GST from the commission base', help: 'On: commission is calculated on the amount without tax.',
    effect: 'Payments recorded after the change' },
  { key: 'commissionable_payment_types', group: 'commission', type: 'multiselect', default: ['subscription'],
    options: PAYMENT_TYPES.map(v => ({ value: v, label: v.replace('_', ' ') })), minItems: 0,
    label: 'Payment types that earn commission', help: 'Usually only subscription payments.',
    effect: 'Payments recorded after the change' },
  { key: 'commission_starts_at', group: 'commission', type: 'enum', default: 'first_payment', options: [
      { value: 'first_payment', label: 'Start of the first paid period' },
      { value: 'attribution', label: 'Date the clinic was referred' }],
    label: 'Commission window starts at', help: 'The commission duration (e.g. 12 months) is counted from this date.',
    effect: 'Referrals that have no payment yet' },

  // Hold
  { key: 'hold_days', group: 'hold', type: 'integer', default: 30, min: 0, max: 180, risky: true,
    label: 'Hold period (days)', help: 'Commission stays on hold this long after the payment, to cover refunds.',
    effect: 'Commissions created after the change' },

  // Payouts
  { key: 'payout_frequency', group: 'payouts', type: 'enum', default: 'monthly', options: [
      { value: 'monthly', label: 'Monthly (automatic drafts on the run day)' },
      { value: 'manual', label: 'Manual only (run from the Payouts screen)' }],
    label: 'Payout frequency', help: '', effect: 'Next run' },
  { key: 'payout_run_day', group: 'payouts', type: 'integer', default: 5, min: 1, max: 28,
    label: 'Payout run day of month', help: 'Drafts include commissions that became available before the 1st of that month.',
    effect: 'Next run' },
  { key: 'auto_create_drafts', group: 'payouts', type: 'boolean', default: true,
    label: 'Create payout drafts automatically', help: 'Drafts still need approval before payment.', effect: 'Next run' },
  { key: 'min_payout_paise', group: 'payouts', type: 'money', default: 100000, min: 0, max: 100000000,
    label: 'Minimum payout', help: 'Smaller balances carry forward to the next run.', effect: 'Next run' },
  { key: 'payout_methods', group: 'payouts', type: 'multiselect', default: ['upi', 'bank'], minItems: 1,
    options: [{ value: 'upi', label: 'UPI' }, { value: 'bank', label: 'Bank transfer' }],
    label: 'Payout methods offered to promoters', help: '', effect: 'Immediately' },

  // Tax
  { key: 'tds_rate_bps', group: 'tax', type: 'bps', default: 200, min: 0, max: 3000, risky: true,
    label: 'TDS rate (with PAN)', help: 'TDS deducted from commission. Confirm the current rate and threshold with your CA.',
    effect: 'Next payout run (each payout keeps the rate it used)' },
  { key: 'tds_rate_no_pan_bps', group: 'tax', type: 'bps', default: 2000, min: 0, max: 5000,
    label: 'TDS rate (no PAN)', help: 'Used when the promoter has not given a PAN.', effect: 'Next payout run' },
  { key: 'tds_threshold_paise', group: 'tax', type: 'money', default: 2000000, min: 0, max: 10000000000,
    label: 'TDS yearly threshold', help: 'No TDS until the promoter\'s commission in the financial year (April–March) exceeds this. Once exceeded, TDS also covers earlier payouts of that year.',
    effect: 'Next payout run' },
  { key: 'gst_on_commission_bps', group: 'tax', type: 'bps', default: 1800, min: 0, max: 2800,
    label: 'GST added for GST-registered promoters', help: 'Added to the payout when the promoter has a GSTIN.', effect: 'Next payout run' },

  // Policies
  { key: 'suspended_promoter_policy', group: 'policies', type: 'enum', default: 'hold', options: [
      { value: 'hold', label: 'Hold releases and payouts while suspended' },
      { value: 'continue', label: 'Keep releasing and paying' }],
    label: 'Suspended promoter', help: '', effect: 'Immediately' },
  { key: 'terminated_promoter_policy', group: 'policies', type: 'enum', default: 'forfeit', options: [
      { value: 'forfeit', label: 'Forfeit unpaid commission' },
      { value: 'pay_out', label: 'Pay out the remaining balance' }],
    label: 'Terminated promoter', help: '', effect: 'At the moment a promoter is terminated' },
  { key: 'refund_after_payout_policy', group: 'policies', type: 'enum', default: 'clawback', options: [
      { value: 'clawback', label: 'Claw back from the next payouts' },
      { value: 'absorb', label: 'Absorb (no clawback)' }],
    label: 'Refund after the commission was paid', help: '', effect: 'Refunds recorded after the change' },

  // Agreement
  { key: 'agreement_version', group: 'agreement', type: 'text', default: 'v1', pattern: '^[A-Za-z0-9._-]{1,20}$', maxLength: 20,
    label: 'Agreement version', help: 'Changing the version makes every promoter accept the agreement again at their next visit.',
    effect: 'Immediately' },
  { key: 'agreement_text', group: 'agreement', type: 'longtext', default: '## ReceptionAI Partner Agreement (v1)\n\nReplace this text with your partner agreement before enabling the program.',
    maxLength: 50000, label: 'Agreement text (Markdown)', help: '', effect: 'Immediately' },

  // Notifications
  { key: 'email_on_approval', group: 'notifications', type: 'boolean', default: true,
    label: 'Email promoter when approved', help: '', effect: 'Immediately' },
  { key: 'email_on_new_clinic', group: 'notifications', type: 'boolean', default: true,
    label: 'Email promoter when a referred clinic signs up', help: '', effect: 'Immediately' },
  { key: 'email_on_payout_paid', group: 'notifications', type: 'boolean', default: true,
    label: 'Email promoter when a payout is paid', help: '', effect: 'Immediately' }
];

const FIELD_MAP = Object.fromEntries(FIELDS.map(f => [f.key, f]));

function defaults() {
  const out = {};
  for (const f of FIELDS) out[f.key] = Array.isArray(f.default) ? [...f.default] : f.default;
  return out;
}

/** Fills keys missing from a stored version with defaults and drops unknown keys */
function withDefaults(stored) {
  const base = defaults();
  for (const f of FIELDS) {
    if (stored && Object.prototype.hasOwnProperty.call(stored, f.key)) base[f.key] = stored[f.key];
  }
  return base;
}

/**
 * Validates a complete settings object. Returns { value, errors }.
 * errors is an object { key: message }.
 */
function validate(input) {
  const errors = {};
  const value = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { value: null, errors: { _: 'Settings must be an object' } };
  }
  for (const key of Object.keys(input)) {
    if (!FIELD_MAP[key]) errors[key] = 'Unknown setting';
  }
  for (const f of FIELDS) {
    const v = Object.prototype.hasOwnProperty.call(input, f.key) ? input[f.key] : f.default;
    switch (f.type) {
      case 'boolean':
        if (typeof v !== 'boolean') errors[f.key] = 'Must be true or false';
        break;
      case 'integer':
      case 'money':
      case 'bps':
        if (typeof v !== 'number' || !Number.isInteger(v)) errors[f.key] = 'Must be a whole number';
        else if (f.min != null && v < f.min) errors[f.key] = `Must be at least ${f.min}`;
        else if (f.max != null && v > f.max) errors[f.key] = `Must be at most ${f.max}`;
        break;
      case 'enum':
        if (!f.options.some(o => o.value === v)) errors[f.key] = 'Not an allowed option';
        break;
      case 'multiselect':
        if (!Array.isArray(v) || v.some(x => !f.options.some(o => o.value === x))) errors[f.key] = 'Contains a value that is not allowed';
        else if (new Set(v).size !== v.length) errors[f.key] = 'Contains duplicates';
        else if (f.minItems && v.length < f.minItems) errors[f.key] = `Choose at least ${f.minItems}`;
        break;
      case 'text':
      case 'longtext':
        if (typeof v !== 'string') errors[f.key] = 'Must be text';
        else if (f.maxLength && v.length > f.maxLength) errors[f.key] = `At most ${f.maxLength} characters`;
        else if (f.pattern && !new RegExp(f.pattern).test(v)) errors[f.key] = 'Invalid format';
        break;
      case 'scheme':
        if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) errors[f.key] = 'Choose a scheme';
        break;
      default:
        errors[f.key] = 'Unsupported type';
    }
    value[f.key] = v;
  }
  return { value, errors };
}

/** Public, UI-friendly description of the fields (no defaults of long texts trimmed) */
function describe() {
  return {
    groups: GROUPS,
    fields: FIELDS.map(f => ({
      key: f.key, group: f.group, type: f.type, label: f.label, help: f.help, effect: f.effect,
      options: f.options || null, min: f.min ?? null, max: f.max ?? null, risky: !!f.risky,
      maxLength: f.maxLength || null, pattern: f.pattern || null, default: f.default
    }))
  };
}

module.exports = { GROUPS, FIELDS, FIELD_MAP, PAYMENT_TYPES, defaults, withDefaults, validate, describe };

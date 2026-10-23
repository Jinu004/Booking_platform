/**
 * Money and date helpers for billing and the promoter program.
 * All amounts are integer paise. Rates are basis points (10000 = 100%).
 * Calculations use BigInt so they never lose precision.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function toBig(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`Expected an integer, got ${value}`);
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new Error(`Expected an integer amount, got ${value}`);
}

// Floor division that also works for negative numbers
function floorDiv(a, b) {
  const q = a / b;
  return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q;
}

/** floor(amount * numerator / denominator) with integers only */
function mulDivFloor(amount, numerator, denominator) {
  const d = toBig(denominator);
  if (d === 0n) throw new Error('Division by zero');
  return Number(floorDiv(toBig(amount) * toBig(numerator), d));
}

/** Rupees (number or string like "5999.50") to paise. Rejects more than 2 decimals. */
function rupeesToPaise(rupees) {
  const s = String(rupees).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid rupee amount: ${rupees}`);
  const [whole, frac = ''] = s.split('.');
  return Number(BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2)));
}

function paiseToRupeesString(paise) {
  const p = toBig(paise);
  const neg = p < 0n;
  const abs = neg ? -p : p;
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

// --- Dates as 'YYYY-MM-DD' strings (calendar days, no time zone involved) ---

function parseDate(d) {
  if (d instanceof Date) return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  if (!m) throw new Error(`Invalid date: ${d}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function isValidDateString(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return false;
  return formatDate(parseDate(d)) === d;
}

/** Inclusive number of days between two dates */
function daysInclusive(start, end) {
  return Math.round((parseDate(end) - parseDate(start)) / DAY_MS) + 1;
}

/** Overlap in days of two inclusive ranges. end2 may be null (open ended). */
function overlapDays(start1, end1, start2, end2) {
  const s = Math.max(parseDate(start1), parseDate(start2));
  const e = end2 == null ? parseDate(end1) : Math.min(parseDate(end1), parseDate(end2));
  if (e < s) return 0;
  return Math.round((e - s) / DAY_MS) + 1;
}

/** Adds calendar months; the day is clamped to the end of the target month */
function addMonths(date, months) {
  const t = new Date(parseDate(date));
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth() + months;
  const day = t.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return formatDate(Date.UTC(y, m, Math.min(day, lastDay)));
}

function addDays(date, days) {
  return formatDate(parseDate(date) + days * DAY_MS);
}

/** Last day of a commission window that starts on `start` and lasts `months` months; null = lifetime */
function windowEnd(start, months) {
  if (months == null) return null;
  return addDays(addMonths(start, months), -1);
}

/** Today's date in India as 'YYYY-MM-DD' */
function todayIST(now = new Date()) {
  return new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/** First day of the month of an IST date, as 'YYYY-MM-01' */
function monthStart(date) {
  return `${String(date).slice(0, 7)}-01`;
}

/** Indian financial year start (1 April) for a date */
function financialYearStart(date) {
  const d = String(date);
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return `${m >= 4 ? y : y - 1}-04-01`;
}

module.exports = {
  toBig,
  mulDivFloor,
  rupeesToPaise,
  paiseToRupeesString,
  parseDate,
  formatDate,
  isValidDateString,
  daysInclusive,
  overlapDays,
  addMonths,
  addDays,
  windowEnd,
  todayIST,
  monthStart,
  financialYearStart
};

// Patient phone numbers (customers.phone) are stored as +<country code><number>.
// No shared helper existed (booking, EHR and CRM each normalised on their own), so this is the one to use for new checks.

/**
 * Normalises a patient phone number, or returns null when it is not acceptable.
 * - Indian numbers become +91 followed by exactly 10 digits. Accepted forms: 10 digits, 0 + 10 digits, 91 + 10 digits, +91 + 10 digits.
 * - Numbers from other countries are accepted only with a leading + and a country code, 8 to 15 digits in total.
 * - Anything else (letters, a wrong length, no + on a foreign number) returns null.
 * @param {string} input
 * @returns {string|null} "+<digits>" or null
 */
function normalizeCustomerPhone(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  // Only digits, spaces and the usual separators; a + is allowed only as the first character
  if (/[^\d+\s\-().]/.test(raw)) return null;
  if (raw.lastIndexOf('+') > 0) return null;

  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  if (raw.startsWith('+')) {
    if (digits.startsWith('91')) return digits.length === 12 ? `+${digits}` : null;
    if (digits.startsWith('0')) return null; // a country code never starts with 0
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  // No +: only the Indian local forms are understood
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return null;
}

const PHONE_INPUT_ERROR = 'Enter a valid phone number: 10 digits for India, or + and the country code for other countries.';

/**
 * The one check for a phone number typed into a form or sent to an API (booking, patient, customer, lead).
 * Spaces, dashes, dots and brackets are ignored. Whatever normalizeCustomerPhone accepts keeps exactly its result
 * (10 digits, 0 + 10 digits, 91 + 10 digits, +91 + 10 digits, + and a country code). Only when that refuses the number, a leading "00"
 * is read as "+" (so "0091 98765 43210" and "00447911123456" work). A number with no "+" that is not an Indian form is refused.
 * @param {string|number} raw
 * @returns {{ ok: true, phone: string } | { ok: false, error: string }}
 */
function validatePhoneInput(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return { ok: false, error: PHONE_INPUT_ERROR };
  const text = String(raw).trim().replace(/[\s\-.()]/g, '');
  if (!text) return { ok: false, error: PHONE_INPUT_ERROR };
  let phone = normalizeCustomerPhone(text);
  if (!phone && text.startsWith('00')) phone = normalizeCustomerPhone(`+${text.slice(2)}`);
  return phone ? { ok: true, phone } : { ok: false, error: PHONE_INPUT_ERROR };
}

/**
 * A phone number made safe for logs: the country code, stars, then only the last 4 digits, for example +91******3210.
 * Use it for every phone number that goes into a log line. Empty values give '[no phone]'.
 * @param {string|number|null|undefined} value
 * @returns {string}
 */
function maskPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '[no phone]';
  const last4 = digits.slice(-4);
  // A number with a country code (more than 10 digits) keeps the code; a 10-digit local number shows no code
  const code = digits.length > 10 ? digits.slice(0, digits.length - 10) : '';
  if (digits.length <= 4) return '******';
  return `${code ? `+${code}` : ''}******${last4}`;
}

module.exports = { normalizeCustomerPhone, validatePhoneInput, PHONE_INPUT_ERROR, maskPhone };

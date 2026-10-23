// Remembers a promoter referral code from a link (?ref=CODE) for the number of days set in the
// program settings, so a clinic that signs up later is still attributed. Storage can be unavailable
// (private mode): everything is wrapped and the sign-up works without it.

const KEY = 'rai_ref';
const DEFAULT_DAYS = 60;

function clean(code) {
  const c = String(code || '').trim().toUpperCase();
  return /^[A-Z0-9]{4,16}$/.test(c) ? c : null;
}

export function captureReferralFromUrl(days = DEFAULT_DAYS) {
  try {
    const code = clean(new URLSearchParams(window.location.search).get('ref'));
    if (!code) return null;
    localStorage.setItem(KEY, JSON.stringify({ code, ts: Date.now(), days: Number(days) || DEFAULT_DAYS }));
    return code;
  } catch {
    return null;
  }
}

export function getStoredReferral() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { code, ts, days } = JSON.parse(raw);
    if (!clean(code) || Date.now() - Number(ts) > (Number(days) || DEFAULT_DAYS) * 86400000) {
      localStorage.removeItem(KEY);
      return null;
    }
    return clean(code);
  } catch {
    return null;
  }
}

export function clearStoredReferral() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

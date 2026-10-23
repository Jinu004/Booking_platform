// Display helpers for amounts stored as integer paise and rates stored as basis points.

export function rupees(paise, { decimals = 2 } = {}) {
  const n = Number(paise || 0) / 100;
  const text = '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return n < 0 ? `-${text}` : text;
}

export function pct(bps) {
  if (bps === null || bps === undefined || bps === '') return '—';
  const n = Number(bps) / 100;
  return `${Number.isInteger(n) ? n : n.toFixed(2)}%`;
}

/** "5999.50" or 5999.5 → 599950; returns null for empty/invalid input */
export function toPaise(rupeesValue) {
  const s = String(rupeesValue ?? '').trim();
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const [w, f = ''] = s.split('.');
  return Number(w) * 100 + Number((f + '00').slice(0, 2));
}

export function fromPaise(paise) {
  if (paise === null || paise === undefined || paise === '') return '';
  return (Number(paise) / 100).toFixed(2).replace(/\.00$/, '');
}

/** "20" or "12.5" (percent) → basis points; null for empty */
export function toBps(percent) {
  const s = String(percent ?? '').trim();
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

export function fromBps(bps) {
  if (bps === null || bps === undefined || bps === '') return '';
  return String(Number(bps) / 100);
}

export function fmtDate(d) {
  if (!d) return '—';
  const s = String(d);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtMonth(ym) {
  if (!ym) return '—';
  const d = new Date(String(ym).slice(0, 7) + '-01T00:00:00');
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Signed-in partner pages: overview, clinics, earnings, payouts, profile.
import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import partnerApi, { setPartnerSession, getPartnerToken } from './partnerApi';
import { Card, Stat, Badge, Field, ErrorBox, Empty, inputClass, btnPrimary, btnSecondary, apiError } from './ui';
import { rupees, pct, fmtDate, fmtMonth } from '../utils/money';

function useLoad(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const res = await fn();
      setState({ loading: false, data: res.data, error: null });
    } catch (err) {
      setState({ loading: false, data: null, error: apiError(err, 'Could not load') });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

function referralLink(code) {
  return `${window.location.origin}/onboarding?ref=${code}`;
}

export function PartnerOverview() {
  const me = useLoad(() => partnerApi.get('/me'));
  const summary = useLoad(() => partnerApi.get('/dashboard/summary'));
  const monthly = useLoad(() => partnerApi.get('/dashboard/monthly'));
  const [copied, setCopied] = useState(false);

  if (summary.error) return <ErrorBox error={summary.error} />;
  if (summary.loading || me.loading) return <p className="text-sm text-gray-500">Loading…</p>;
  const s = summary.data;
  const code = me.data?.code;
  const link = code ? referralLink(code) : '';

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };
  const share = `https://wa.me/?text=${encodeURIComponent(`Try ReceptionAI, the AI WhatsApp receptionist for clinics. Sign up with my link: ${link}`)}`;
  const progress = s.min_payout_paise > 0 ? Math.min(100, Math.max(0, Math.round((s.available_paise / s.min_payout_paise) * 100))) : 100;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Hello, {me.data?.name?.split(' ')[0]}</h1>

      {(!s.has_payout_details || (s.kyc_required && s.kyc_status !== 'verified')) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {!s.has_payout_details
            ? <>Add your PAN and payout details so we can pay you. <Link to="/partner/profile" className="underline font-medium">Add details</Link></>
            : s.kyc_status === 'rejected'
              ? <>Your payout details need a correction. <Link to="/partner/profile" className="underline font-medium">Review</Link></>
              : 'Your payout details are being verified. Payouts start once they are verified.'}
        </div>
      )}

      <Card title="Your referral link">
        <div className="flex flex-col sm:flex-row gap-2">
          <input className={`${inputClass} font-mono`} readOnly value={link} onFocus={e => e.target.select()} />
          <button className={btnPrimary} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          <a className={`${btnSecondary} text-center`} href={share} target="_blank" rel="noreferrer">Share on WhatsApp</a>
        </div>
        <p className="text-xs text-gray-500 mt-2">Referral code: <span className="font-mono font-semibold text-gray-800">{code}</span>. Clinics can also type it on the sign-up form.</p>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Clinics referred" value={s.clinics_referred} hint={s.awaiting_activation ? `${s.awaiting_activation} awaiting activation` : null} />
        <Stat label="Paying clinics" value={s.active_paying} tone="indigo" />
        <Stat label="Earned this month" value={rupees(s.this_month_paise)} />
        <Stat label="Lifetime paid" value={rupees(s.paid_paise)} tone="green" />
        <Stat label="On hold" value={rupees(s.pending_paise)} tone="amber" hint={s.next_release_at ? `Next release ${fmtDate(s.next_release_at)} (held ${s.hold_days} days)` : `Held ${s.hold_days} days after payment`} />
        <Stat label="Available" value={rupees(s.available_paise)} tone={s.available_paise < 0 ? 'red' : 'green'} hint={s.available_paise < 0 ? 'Negative after a refund; it is netted against future earnings' : null} />
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm col-span-2">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Next payout</p>
          <p className="mt-1 text-sm text-gray-700">{s.next_payout_date ? fmtDate(s.next_payout_date) : 'Payouts are made manually'} · minimum {rupees(s.min_payout_paise, { decimals: 0 })}</p>
          <div className="mt-2 h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-indigo-500" style={{ width: `${progress}%` }} /></div>
          <p className="text-xs text-gray-500 mt-1">{progress}% of the minimum available</p>
        </div>
      </div>

      <Card title="Earnings, last 12 months">
        {monthly.loading ? <p className="text-sm text-gray-500">Loading…</p> : (
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={(monthly.data || []).map(m => ({ month: fmtMonth(m.month), Earned: m.earned_paise / 100, Paid: m.paid_paise / 100 }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${v.toLocaleString('en-IN')}`} width={70} />
                <Tooltip formatter={(v) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`} />
                <Legend />
                <Bar dataKey="Earned" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Paid" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}

export function PartnerClinics() {
  const { loading, data, error } = useLoad(() => partnerApi.get('/clinics'));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Your clinics</h1>
      <ErrorBox error={error} />
      <Card>
        {loading ? <p className="text-sm text-gray-500">Loading…</p> : !data?.length ? <Empty>No clinics yet. Share your referral link to get started.</Empty> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-gray-500 border-b">
                <th className="py-2 pr-4">Clinic</th><th className="py-2 pr-4">Plan</th><th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Joined</th><th className="py-2 pr-4">Commission until</th><th className="py-2 text-right">Earned</th>
              </tr></thead>
              <tbody>
                {data.map(c => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2 pr-4"><div className="font-medium text-gray-900">{c.clinic_name}</div>{c.city && <div className="text-xs text-gray-500">{c.city}</div>}</td>
                    <td className="py-2 pr-4 capitalize">{c.plan || '—'}</td>
                    <td className="py-2 pr-4 space-x-1">
                      <Badge status={c.clinic_status} label={c.clinic_status === 'pending' ? 'Awaiting activation' : undefined} />
                      {c.referral_status !== 'active' && <Badge status={c.referral_status} />}
                      {c.no_commission && <Badge status="void" label="No commission" />}
                    </td>
                    <td className="py-2 pr-4">{fmtDate(c.attributed_at)}</td>
                    <td className="py-2 pr-4">{c.window_start ? (c.commission_ends ? fmtDate(c.commission_ends) : 'Lifetime') : 'Starts with first payment'}</td>
                    <td className="py-2 text-right font-medium">{rupees(c.earned_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

const ENTRY_LABEL = { commission: 'Commission', reversal: 'Refund reversal', adjustment: 'Adjustment', bonus: 'Bonus' };

export function PartnerEarnings() {
  const [status, setStatus] = useState('');
  const { loading, data, error } = useLoad(() => partnerApi.get('/earnings', { params: { status: status || undefined, limit: 300 } }), [status]);

  const exportCsv = () => {
    const rows = [['Date', 'Clinic', 'Type', 'Period', 'Base', 'Rate', 'Amount', 'Status']];
    for (const e of data || []) {
      rows.push([fmtDate(e.created_at), e.clinic_name || '', ENTRY_LABEL[e.entry_type], e.period_start ? `${e.period_start} to ${e.period_end}` : '',
        (e.base_paise / 100).toFixed(2), e.rate_bps ? (e.rate_bps / 100) + '%' : '', (e.amount_paise / 100).toFixed(2), e.status]);
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'earnings.csv'; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900">Earnings</h1>
        <div className="flex gap-2">
          <select className={inputClass} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All</option><option value="pending">On hold</option><option value="available">Available</option>
            <option value="paid">Paid</option><option value="void">Cancelled</option>
          </select>
          <button className={btnSecondary} onClick={exportCsv} disabled={!data?.length}>CSV</button>
        </div>
      </div>
      <ErrorBox error={error} />
      <Card>
        {loading ? <p className="text-sm text-gray-500">Loading…</p> : !data?.length ? <Empty>No earnings yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-gray-500 border-b">
                <th className="py-2 pr-4">Date</th><th className="py-2 pr-4">Clinic</th><th className="py-2 pr-4">Details</th>
                <th className="py-2 pr-4 text-right">Amount</th><th className="py-2">Status</th>
              </tr></thead>
              <tbody>
                {data.map(e => (
                  <tr key={e.id} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-4 whitespace-nowrap">{fmtDate(e.created_at)}</td>
                    <td className="py-2 pr-4">{e.clinic_name || '—'}</td>
                    <td className="py-2 pr-4 text-gray-600">
                      <div>{ENTRY_LABEL[e.entry_type]}{e.entry_type === 'commission' && <> · {pct(e.rate_bps)} of {rupees(e.base_paise)}</>}</div>
                      {e.period_start && <div className="text-xs text-gray-500">Period {fmtDate(e.period_start)} – {fmtDate(e.period_end)}{e.eligible_days !== e.period_days && e.eligible_days ? ` (${e.eligible_days} of ${e.period_days} days in your commission window)` : ''}</div>}
                      {e.note && <div className="text-xs text-gray-500">{e.note}</div>}
                      {e.status === 'void' && e.void_reason && <div className="text-xs text-gray-500">{e.void_reason}</div>}
                    </td>
                    <td className={`py-2 pr-4 text-right font-medium ${e.amount_paise < 0 ? 'text-red-600' : ''}`}>{rupees(e.amount_paise)}</td>
                    <td className="py-2">
                      <Badge status={e.status} />
                      {e.status === 'pending' && <div className="text-xs text-gray-500 mt-1">until {fmtDate(e.available_at)}</div>}
                      {e.payout_month && <div className="text-xs text-gray-500 mt-1">{fmtMonth(e.payout_month)} payout</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function PartnerPayouts() {
  const { loading, data, error } = useLoad(() => partnerApi.get('/payouts'));
  const [dlError, setDlError] = useState(null);

  const download = async (p) => {
    setDlError(null);
    try {
      const res = await partnerApi.get(`/payouts/${p.id}/statement.pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a'); a.href = url; a.download = `payout-${p.period_month.slice(0, 7)}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch {
      setDlError('Could not download the statement');
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Payouts</h1>
      <ErrorBox error={error || dlError} />
      <Card>
        {loading ? <p className="text-sm text-gray-500">Loading…</p> : !data?.length ? <Empty>No payouts yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-gray-500 border-b">
                <th className="py-2 pr-4">Month</th><th className="py-2 pr-4 text-right">Commission</th><th className="py-2 pr-4 text-right">GST</th>
                <th className="py-2 pr-4 text-right">TDS</th><th className="py-2 pr-4 text-right">Paid to you</th><th className="py-2 pr-4">Status</th><th className="py-2"></th>
              </tr></thead>
              <tbody>
                {data.map(p => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">{fmtMonth(p.period_month)}</td>
                    <td className="py-2 pr-4 text-right">{rupees(p.gross_paise)}</td>
                    <td className="py-2 pr-4 text-right">{p.gst_paise ? rupees(p.gst_paise) : '—'}</td>
                    <td className="py-2 pr-4 text-right">{p.tds_paise ? `-${rupees(p.tds_paise)}` : '—'}</td>
                    <td className="py-2 pr-4 text-right font-semibold">{rupees(p.net_paise)}</td>
                    <td className="py-2 pr-4"><Badge status={p.status === 'draft' || p.status === 'approved' ? 'pending' : p.status} label={p.status === 'draft' || p.status === 'approved' ? 'Processing' : undefined} />
                      {p.utr && <div className="text-xs text-gray-500 mt-1">Ref {p.utr} · {fmtDate(p.paid_at)}</div>}</td>
                    <td className="py-2 text-right"><button className="text-indigo-600 hover:underline text-sm" onClick={() => download(p)}>Statement</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function PartnerProfile() {
  const me = useLoad(() => partnerApi.get('/me'));
  const config = useLoad(() => partnerApi.get('/config'));
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [pwMsg, setPwMsg] = useState(null);

  useEffect(() => {
    if (me.data && !form) {
      setForm({ pan: '', gstin: me.data.gstin || '', payout_method: me.data.payout_method || 'upi', upi_id: me.data.upi_id || '', bank_account: '', bank_ifsc: me.data.bank_ifsc || '', bank_holder_name: me.data.bank_holder_name || '' });
    }
  }, [me.data, form]);

  if (me.loading || !form) return <p className="text-sm text-gray-500">Loading…</p>;
  const p = me.data;
  const methods = config.data?.payout_methods || ['upi', 'bank'];
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setErrors({}); setError(null); setSaved(false);
    try {
      const res = await partnerApi.put('/me/payout-details', form);
      setSaved(true);
      setPartnerSession(getPartnerToken(), res.data);
      me.reload();
      setForm(f => ({ ...f, pan: '', bank_account: '' }));
    } catch (err) {
      setError(apiError(err)); setErrors(err?.details || {});
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwMsg(null);
    try {
      await partnerApi.post('/me/password', pw);
      setPwMsg({ ok: true, text: 'Password changed' });
      setPw({ current_password: '', new_password: '' });
    } catch (err) {
      setPwMsg({ ok: false, text: apiError(err) });
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
      <Card title="Your details">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><dt className="text-gray-500">Name</dt><dd className="font-medium">{p.name}</dd></div>
          <div><dt className="text-gray-500">Referral code</dt><dd className="font-mono font-semibold">{p.code}</dd></div>
          <div><dt className="text-gray-500">Email</dt><dd>{p.email}</dd></div>
          <div><dt className="text-gray-500">Phone</dt><dd>{p.phone}</dd></div>
          <div><dt className="text-gray-500">Agreement</dt><dd>{p.agreement_version || '—'} {p.agreement_accepted_at && <span className="text-gray-500">accepted {fmtDate(p.agreement_accepted_at)}</span>}</dd></div>
          <div><dt className="text-gray-500">Verification</dt><dd><Badge status={p.kyc_status} /></dd></div>
        </dl>
        <p className="text-xs text-gray-500 mt-3">To change your name, email or phone, contact support.</p>
      </Card>

      <Card title="Payout and tax details">
        {p.kyc_status === 'rejected' && p.kyc_note && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Please fix: {p.kyc_note}</div>}
        {p.payout_method && (
          <p className="text-sm text-gray-600 mb-3">
            Current: PAN {p.pan || '—'} · {p.payout_method === 'upi' ? `UPI ${p.upi_id}` : `Bank ****${p.bank_account_last4} (${p.bank_ifsc})`}{p.gstin ? ` · GSTIN ${p.gstin}` : ''}.
            Saving new details sends them for verification again.
          </p>
        )}
        <form onSubmit={save} className="space-y-3">
          <ErrorBox error={error} />
          <Field label="PAN" required error={errors.pan} hint="Needed for TDS. Re-enter it whenever you save."><input className={`${inputClass} uppercase`} value={form.pan} onChange={set('pan')} placeholder="ABCDE1234F" maxLength={10} /></Field>
          <Field label="GSTIN (only if you are GST registered)" error={errors.gstin}><input className={`${inputClass} uppercase`} value={form.gstin} onChange={set('gstin')} maxLength={15} /></Field>
          <Field label="Payout method" error={errors.payout_method}>
            <select className={inputClass} value={form.payout_method} onChange={set('payout_method')}>
              {methods.includes('upi') && <option value="upi">UPI</option>}
              {methods.includes('bank') && <option value="bank">Bank transfer</option>}
            </select>
          </Field>
          {form.payout_method === 'upi' ? (
            <Field label="UPI ID" required error={errors.upi_id}><input className={inputClass} value={form.upi_id} onChange={set('upi_id')} placeholder="name@bank" /></Field>
          ) : (
            <>
              <Field label="Account holder name" required error={errors.bank_holder_name}><input className={inputClass} value={form.bank_holder_name} onChange={set('bank_holder_name')} /></Field>
              <Field label="Account number" required error={errors.bank_account} hint="Stored encrypted. Re-enter it whenever you save."><input className={inputClass} value={form.bank_account} onChange={set('bank_account')} inputMode="numeric" autoComplete="off" /></Field>
              <Field label="IFSC" required error={errors.bank_ifsc}><input className={`${inputClass} uppercase`} value={form.bank_ifsc} onChange={set('bank_ifsc')} maxLength={11} /></Field>
            </>
          )}
          <div className="flex items-center gap-3">
            <button className={btnPrimary} disabled={saving}>{saving ? 'Saving…' : 'Save and submit for verification'}</button>
            {saved && <span className="text-sm text-green-700">Saved</span>}
          </div>
        </form>
      </Card>

      <Card title="Change password">
        <form onSubmit={changePassword} className="space-y-3">
          {pwMsg && <p className={`text-sm ${pwMsg.ok ? 'text-green-700' : 'text-red-600'}`}>{pwMsg.text}</p>}
          <Field label="Current password"><input className={inputClass} type="password" autoComplete="current-password" value={pw.current_password} onChange={e => setPw(s => ({ ...s, current_password: e.target.value }))} /></Field>
          <Field label="New password" hint="At least 8 characters"><input className={inputClass} type="password" autoComplete="new-password" value={pw.new_password} onChange={e => setPw(s => ({ ...s, new_password: e.target.value }))} /></Field>
          <button className={btnSecondary}>Change password</button>
        </form>
      </Card>
    </div>
  );
}

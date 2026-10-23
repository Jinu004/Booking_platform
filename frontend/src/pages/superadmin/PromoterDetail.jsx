// Super admin: one promoter — status, commercial terms, KYC, referred clinics, ledger, adjustments, audit.
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { promoterAdmin } from '../../services/promoterAdmin.service';
import { Card, Badge, Field, ErrorBox, Modal, Empty, inputClass, btnPrimary, btnSecondary, btnDanger, apiError } from '../../partner/ui';
import { rupees, pct, fmtDate, fromBps, toBps, fromPaise, toPaise, todayISO } from '../../utils/money';
import useStore from '../../store/useStore';

const ACTIONS = {
  pending: ['approve', 'reject'],
  active: ['suspend', 'terminate'],
  suspended: ['reactivate', 'terminate'],
  terminated: [],
  rejected: []
};
const ACTION_LABEL = { approve: 'Approve', reject: 'Reject', suspend: 'Suspend', reactivate: 'Reactivate', terminate: 'Terminate' };
const ACTION_DONE = { approve: 'Approved', reject: 'Rejected', suspend: 'Suspended', reactivate: 'Reactivated', terminate: 'Terminated' };

export default function PromoterDetail() {
  const { id } = useParams();
  const { addToast } = useStore();
  const [data, setData] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [schemes, setSchemes] = useState([]);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);

  const load = async () => {
    setError(null);
    try {
      const [d, l, s, st] = await Promise.all([promoterAdmin.promoter(id), promoterAdmin.ledger({ promoterId: id, limit: 300 }), promoterAdmin.schemes(), promoterAdmin.settings()]);
      setData(d.data); setLedger(l.data); setSchemes(s.data); setSettings(st.data.settings);
    } catch (err) { setError(apiError(err)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (error && !data) return <div className="p-8"><ErrorBox error={error} /></div>;
  if (!data) return <p className="p-8 text-sm text-gray-500">Loading…</p>;
  const p = data.promoter;
  const scheme = schemes.find(s => s.id === p.scheme_id);
  const done = (msg) => { setModal(null); addToast(msg, 'success'); load(); };
  const sum = (st) => ledger.filter(e => e.status === st).reduce((t, e) => t + Number(e.amount_paise), 0);

  return (
    <div className="p-0 md:p-8 space-y-6 max-w-5xl">
      <div className="space-y-2">
        <Link to="/superadmin/promoters?tab=promoters" className="text-sm text-indigo-600 hover:text-indigo-900">← Promoters</Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{p.name}</h1>
            <span className="font-mono text-sm bg-gray-100 rounded px-2 py-0.5">{p.code}</span>
            <Badge status={p.status} />
          </div>
          <div className="flex gap-2">
            {ACTIONS[p.status].map(a => (
              <button key={a} className={['reject', 'suspend', 'terminate'].includes(a) ? btnDanger : btnPrimary} onClick={() => setModal({ type: 'status', action: a })}>{ACTION_LABEL[a]}</button>
            ))}
          </div>
        </div>
        {p.status_reason && <p className="text-sm text-gray-500">Reason: {p.status_reason}</p>}
      </div>
      <ErrorBox error={error} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Contact">
          <dl className="text-sm space-y-1">
            <div>{p.email}</div><div>{p.phone}</div>{p.city && <div>{p.city}</div>}
            <div className="text-xs text-gray-500 pt-2">Applied {fmtDate(p.created_at)}{p.approved_at && ` · approved ${fmtDate(p.approved_at)}`}{p.last_login && ` · last sign-in ${fmtDate(p.last_login)}`}</div>
            <div className="text-xs text-gray-500">Agreement {p.agreement_version || '—'}{p.agreement_accepted_at && ` accepted ${fmtDate(p.agreement_accepted_at)}`}{settings && p.agreement_version !== settings.agreement_version && <span className="text-amber-700"> (current is {settings.agreement_version})</span>}</div>
          </dl>
        </Card>
        <Card title="Commercial terms" actions={<button className="text-sm text-indigo-600 hover:underline" onClick={() => setModal({ type: 'terms' })}>Change</button>}>
          <dl className="text-sm space-y-1">
            <div>Scheme: <b>{scheme?.name || '—'}</b> {scheme && <span className="text-xs text-gray-500">({pct(scheme.base_rate_bps)}, {scheme.commission_months ? `${scheme.commission_months} months` : 'lifetime'})</span>}</div>
            <div>Rate override: {p.override_rate_bps != null ? pct(p.override_rate_bps) : 'none'}</div>
            <div>Duration override: {p.override_months_set ? (p.override_commission_months ? `${p.override_commission_months} months` : 'lifetime') : 'none'}</div>
            <div>Minimum payout: {p.override_min_payout_paise != null ? rupees(p.override_min_payout_paise, { decimals: 0 }) : `default (${settings ? rupees(settings.min_payout_paise, { decimals: 0 }) : '…'})`}</div>
          </dl>
        </Card>
        <Card title="KYC & payout details" actions={p.kyc_status === 'submitted' ? <button className="text-sm text-indigo-600 hover:underline" onClick={() => setModal({ type: 'kyc' })}>Review</button> : (p.payout_method ? <button className="text-sm text-gray-500 hover:underline" onClick={() => setModal({ type: 'kyc' })}>Change decision</button> : null)}>
          <dl className="text-sm space-y-1">
            <div><Badge status={p.kyc_status} /></div>
            <div>PAN: {p.pan || '—'}</div>
            {p.gstin && <div>GSTIN: {p.gstin}</div>}
            <div>{p.payout_method === 'upi' ? `UPI: ${p.upi_id}` : p.payout_method === 'bank' ? `Bank: ${p.bank_holder_name}, ****${p.bank_account_last4}, ${p.bank_ifsc}` : 'No payout details'}</div>
            {p.kyc_note && <div className="text-xs text-gray-500">Note: {p.kyc_note}</div>}
          </dl>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <Card><p className="text-gray-500 text-xs uppercase">On hold</p><p className="text-xl font-bold">{rupees(sum('pending'))}</p></Card>
        <Card><p className="text-gray-500 text-xs uppercase">Owed</p><p className="text-xl font-bold text-indigo-700">{rupees(sum('available'))}</p></Card>
        <Card><p className="text-gray-500 text-xs uppercase">Paid</p><p className="text-xl font-bold text-green-700">{rupees(sum('paid'))}</p></Card>
        <Card><p className="text-gray-500 text-xs uppercase">Voided</p><p className="text-xl font-bold text-gray-500">{rupees(sum('void'))}</p></Card>
      </div>

      <Card title={`Referred clinics (${data.referrals.length})`}>
        {!data.referrals.length ? <Empty>No clinics yet.</Empty> : (
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-gray-500 border-b"><th className="py-2 pr-3">Clinic</th><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">Referral</th><th className="py-2 pr-3">Clinic status</th><th className="py-2 pr-3">Referred</th><th className="py-2 text-right">Earned</th></tr></thead>
            <tbody>{data.referrals.map(r => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="py-2 pr-3">{r.tenant_id ? <Link className="text-indigo-600 hover:underline" to={`/superadmin/tenants/${r.tenant_id}`}>{r.tenant_name}</Link> : <span>{r.tenant_name} <span className="text-xs text-gray-500">(deleted)</span></span>}</td>
                <td className="py-2 pr-3 text-xs">{r.source.replace(/_/g, ' ')}</td>
                <td className="py-2 pr-3"><Badge status={r.status} />{r.no_commission && <Badge status="void" label="No commission" />}{r.flag_reason && <div className="text-xs text-gray-500">{r.flag_reason}</div>}</td>
                <td className="py-2 pr-3">{r.tenant_status ? <Badge status={r.tenant_status} label={r.tenant_status === 'pending' ? 'Awaiting approval' : undefined} /> : '—'}</td>
                <td className="py-2 pr-3">{fmtDate(r.attributed_at)}</td>
                <td className="py-2 text-right">{rupees(r.earned_paise)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>

      <Card title="Ledger" actions={<button className="text-sm text-indigo-600 hover:underline" onClick={() => setModal({ type: 'adjust' })}>+ Adjustment</button>}>
        {!ledger.length ? <Empty>No entries yet.</Empty> : (
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="min-w-full text-xs">
              <thead><tr className="text-left uppercase text-gray-500 border-b"><th className="py-2 pr-3">Created</th><th className="py-2 pr-3">Clinic</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Calculation</th><th className="py-2 pr-3 text-right">Amount</th><th className="py-2">Status</th></tr></thead>
              <tbody>{ledger.map(e => (
                <tr key={e.id} className="border-b last:border-0 align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(e.created_at)}</td>
                  <td className="py-1.5 pr-3">{e.tenant_name || '—'}</td>
                  <td className="py-1.5 pr-3">{e.entry_type}</td>
                  <td className="py-1.5 pr-3 text-gray-600">
                    {e.entry_type === 'commission' && <>{pct(e.rate_bps)} ({e.rate_source}) of {rupees(e.base_paise)}{e.eligible_days !== e.period_days ? ` × ${e.eligible_days}/${e.period_days} days` : ''}{e.capped ? ' · capped' : ''}<br /><span className="text-gray-400">{e.period_start} – {e.period_end} · {e.scheme_name} v{e.scheme_version} · settings v{e.settings_version}</span></>}
                    {e.note && <div>{e.note}</div>}{e.void_reason && <div>{e.void_reason}</div>}
                  </td>
                  <td className={`py-1.5 pr-3 text-right ${Number(e.amount_paise) < 0 ? 'text-red-600' : ''}`}>{rupees(e.amount_paise)}</td>
                  <td className="py-1.5"><Badge status={e.status} />{e.status === 'pending' && <div className="text-gray-400">{fmtDate(e.available_at)}</div>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Activity">
        {!data.audit.length ? <Empty>No activity.</Empty> : (
          <ul className="text-xs space-y-1.5">{data.audit.map(a => (
            <li key={a.id}><span className="text-gray-500">{new Date(a.created_at).toLocaleString('en-IN')}</span> · <span className="font-mono">{a.action}</span> · {a.actor_name || a.actor_type}{a.reason && <> — “{a.reason}”</>}</li>
          ))}</ul>
        )}
      </Card>

      {modal?.type === 'status' && <StatusModal promoter={p} action={modal.action} schemes={schemes} settings={settings} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'terms' && <TermsModal promoter={p} schemes={schemes} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'kyc' && <KycModal promoter={p} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'adjust' && <AdjustModal promoter={p} referrals={data.referrals} onClose={() => setModal(null)} onDone={done} />}
    </div>
  );
}

function StatusModal({ promoter, action, schemes, settings, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [schemeId, setSchemeId] = useState(promoter.scheme_id);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const res = await promoterAdmin.promoterAction(promoter.id, action, { reason, scheme_id: action === 'approve' ? schemeId : undefined });
      onDone(`${ACTION_DONE[action]}${res.data.forfeitedEntries ? ` · ${res.data.forfeitedEntries} unpaid entries forfeited` : ''}`);
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${ACTION_LABEL[action]} ${promoter.name}`} onClose={onClose}>
      <ErrorBox error={error} />
      {action === 'approve' && (
        <Field label="Commission scheme"><select className={inputClass} value={schemeId} onChange={e => setSchemeId(e.target.value)}>{schemes.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name} ({pct(s.base_rate_bps)})</option>)}</select></Field>
      )}
      {action === 'terminate' && settings && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {settings.terminated_promoter_policy === 'forfeit' ? 'Program settings: unpaid commission is forfeited and open payouts are cancelled.' : 'Program settings: the remaining balance will still be paid out.'}
        </p>
      )}
      {action === 'suspend' && settings && <p className="text-sm text-gray-600">{settings.suspended_promoter_policy === 'hold' ? 'While suspended, releases and payouts are on hold. Sign-in is blocked.' : 'Commission keeps being released and paid while suspended. Sign-in is blocked.'}</p>}
      <Field label="Reason" required={action !== 'approve'} hint="Recorded in the audit log and shown to the promoter in the email."><input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Cancel</button>
        <button className={['reject', 'suspend', 'terminate'].includes(action) ? btnDanger : btnPrimary} onClick={submit} disabled={busy || (action !== 'approve' && !reason.trim())}>{busy ? 'Saving…' : ACTION_LABEL[action]}</button></div>
    </Modal>
  );
}

function TermsModal({ promoter, schemes, onClose, onDone }) {
  const [form, setForm] = useState({
    scheme_id: promoter.scheme_id,
    rate: fromBps(promoter.override_rate_bps),
    months_set: promoter.override_months_set,
    months: promoter.override_commission_months ?? '',
    min_payout: fromPaise(promoter.override_min_payout_paise),
    applyTo: 'new', effectiveFrom: todayISO(), reason: ''
  });
  const [error, setError] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const submit = async () => {
    setBusy(true); setError(null); setErrors({});
    try {
      const res = await promoterAdmin.promoterTerms(promoter.id, {
        scheme_id: form.scheme_id,
        override_rate_bps: String(form.rate).trim() === '' ? null : toBps(form.rate),
        override_months_set: form.months_set,
        override_commission_months: form.months_set ? (String(form.months).trim() === '' ? null : Number(form.months)) : null,
        override_min_payout_paise: String(form.min_payout).trim() === '' ? null : toPaise(form.min_payout),
        applyTo: form.applyTo, effectiveFrom: form.effectiveFrom, reason: form.reason
      });
      onDone(`Terms saved${res.data.affectedReferrals ? ` · ${res.data.affectedReferrals} clinics updated` : ''}`);
    } catch (err) { setError(apiError(err)); setErrors(err?.details || {}); } finally { setBusy(false); }
  };
  return (
    <Modal title="Commercial terms" onClose={onClose}>
      <ErrorBox error={error} />
      <Field label="Scheme"><select className={inputClass} value={form.scheme_id} onChange={set('scheme_id')}>{schemes.filter(s => s.is_active || s.id === promoter.scheme_id).map(s => <option key={s.id} value={s.id}>{s.name} ({pct(s.base_rate_bps)})</option>)}</select></Field>
      <Field label="Rate override (%)" hint="Empty = use the scheme (per-plan rates and tiers apply)" error={errors.override_rate_bps}><input className={inputClass} value={form.rate} onChange={set('rate')} inputMode="decimal" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.months_set} onChange={set('months_set')} /> Override duration</label>
      {form.months_set && <Field label="Months" hint="Empty = lifetime" error={errors.override_commission_months}><input className={inputClass} value={form.months} onChange={set('months')} inputMode="numeric" /></Field>}
      <Field label="Minimum payout override (₹)" hint="Empty = program default" error={errors.override_min_payout_paise}><input className={inputClass} value={form.min_payout} onChange={set('min_payout')} inputMode="decimal" /></Field>
      <div className="space-y-2 border-t pt-3">
        <label className="flex items-center gap-2 text-sm"><input type="radio" checked={form.applyTo === 'new'} onChange={() => setForm(f => ({ ...f, applyTo: 'new' }))} /> Only clinics referred from now on</label>
        <label className="flex items-center gap-2 text-sm flex-wrap"><input type="radio" checked={form.applyTo === 'existing'} onChange={() => setForm(f => ({ ...f, applyTo: 'existing' }))} /> Also this promoter's existing clinics, for periods from
          <input type="date" className="border border-gray-300 rounded px-2 py-1 text-sm" value={form.effectiveFrom} onChange={set('effectiveFrom')} disabled={form.applyTo !== 'existing'} /></label>
        <p className="text-xs text-gray-500">The minimum payout applies from the next payout run either way. Commissions already created never change.</p>
      </div>
      <Field label="Reason" required><input className={inputClass} value={form.reason} onChange={set('reason')} /></Field>
      <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={submit} disabled={busy || !form.reason.trim()}>{busy ? 'Saving…' : 'Save terms'}</button></div>
    </Modal>
  );
}

function KycModal({ promoter, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const decide = async (decision) => {
    setError(null);
    try { await promoterAdmin.reviewKyc(promoter.id, { decision, note }); onDone(`KYC ${decision}`); } catch (err) { setError(apiError(err)); }
  };
  return (
    <Modal title="Review KYC and payout details" onClose={onClose}>
      <ErrorBox error={error} />
      <dl className="text-sm space-y-1">
        <div>Name: <b>{promoter.name}</b></div>
        <div>PAN: {promoter.pan || '—'} <span className="text-xs text-gray-500">(masked; verify against the document the promoter sends you)</span></div>
        {promoter.gstin && <div>GSTIN: {promoter.gstin}</div>}
        <div>{promoter.payout_method === 'upi' ? `UPI: ${promoter.upi_id}` : `Bank: ${promoter.bank_holder_name}, ****${promoter.bank_account_last4}, ${promoter.bank_ifsc}`}</div>
      </dl>
      <Field label="Note" hint="Required when rejecting; the promoter sees it."><input className={inputClass} value={note} onChange={e => setNote(e.target.value)} /></Field>
      <div className="flex justify-end gap-2"><button className={btnDanger} onClick={() => decide('rejected')}>Reject</button><button className={btnPrimary} onClick={() => decide('verified')}>Verify</button></div>
    </Modal>
  );
}

function AdjustModal({ promoter, referrals, onClose, onDone }) {
  const [form, setForm] = useState({ amount: '', sign: '+', tenant_id: '', note: '' });
  const [error, setError] = useState(null);
  const submit = async () => {
    setError(null);
    const paise = toPaise(form.amount);
    if (!paise || Number.isNaN(paise)) { setError('Enter an amount'); return; }
    try {
      await promoterAdmin.addAdjustment({ promoter_id: promoter.id, tenant_id: form.tenant_id || null, amount_paise: form.sign === '-' ? -paise : paise, note: form.note });
      onDone('Adjustment added');
    } catch (err) { setError(apiError(err)); }
  };
  return (
    <Modal title="Manual adjustment" onClose={onClose}>
      <p className="text-sm text-gray-600">Adds a ledger entry that is available immediately and included in the next payout. Use a negative amount to recover money.</p>
      <ErrorBox error={error} />
      <div className="flex gap-2">
        <select className={`${inputClass} w-20`} value={form.sign} onChange={e => setForm(f => ({ ...f, sign: e.target.value }))}><option value="+">+</option><option value="-">−</option></select>
        <input className={inputClass} placeholder="Amount (₹)" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} inputMode="decimal" />
      </div>
      <Field label="Clinic (optional)"><select className={inputClass} value={form.tenant_id} onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value }))}><option value="">— none —</option>{referrals.filter(r => r.tenant_id).map(r => <option key={r.id} value={r.tenant_id}>{r.tenant_name}</option>)}</select></Field>
      <Field label="Note" required><input className={inputClass} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></Field>
      <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={submit} disabled={!form.note.trim()}>Add</button></div>
    </Modal>
  );
}

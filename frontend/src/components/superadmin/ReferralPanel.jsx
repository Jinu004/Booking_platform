// Tenant edit page: who referred this clinic, its dated commission terms, and admin actions
// (assign within the late-attribution window, reassign, change terms from a date, flag/clear/revoke).
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { promoterAdmin } from '../../services/promoterAdmin.service';
import { Badge, Field, ErrorBox, Modal, inputClass, btnPrimary, btnSecondary, btnDanger, apiError } from '../../partner/ui';
import { rupees, pct, fmtDate, fromBps, toBps, todayISO } from '../../utils/money';
import useStore from '../../store/useStore';

export default function ReferralPanel({ tenantId }) {
  const { addToast } = useStore();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);

  const load = () => promoterAdmin.tenantReferral(tenantId).then(r => setData(r.data)).catch(err => setError(apiError(err)));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId]);
  const done = (msg) => { setModal(null); addToast(msg, 'success'); load(); };

  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="text-sm text-gray-500">Loading referral…</p>;
  const r = data.referral;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Promoter referral</h2>
        <div className="flex gap-3 text-sm">
          {!r && data.canAssign && <button className="text-indigo-600 hover:underline" onClick={() => setModal({ type: 'assign' })}>Assign promoter</button>}
          {r && r.status !== 'revoked' && data.reassignmentAllowed && <button className="text-indigo-600 hover:underline" onClick={() => setModal({ type: 'assign' })}>Reassign</button>}
          {r && r.status !== 'revoked' && <button className="text-indigo-600 hover:underline" onClick={() => setModal({ type: 'terms' })}>Change terms</button>}
        </div>
      </div>

      {!r ? (
        <p className="text-sm text-gray-500">
          Not referred by a promoter.{' '}
          {data.canAssign ? `A promoter can still be assigned until ${fmtDate(data.lateDeadline)}.` : 'The late-attribution window has passed (see program settings).'}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link to={`/superadmin/promoters/${r.promoter_id}`} className="font-medium text-indigo-600 hover:underline">{r.promoter_name}</Link>
            <span className="font-mono text-xs bg-gray-100 rounded px-1.5">{r.promoter_code}</span>
            <Badge status={r.status} />
            {r.no_commission && <Badge status="void" label="No commission" />}
            <span className="text-gray-500">· {r.source.replace(/_/g, ' ')} · {fmtDate(r.attributed_at)}</span>
          </div>
          {r.flag_reason && <p className="text-sm text-orange-700">{r.flag_reason}</p>}
          <p className="text-sm text-gray-600">
            Commission window starts {r.window_start ? fmtDate(r.window_start) : 'with the first payment'} ·
            on hold {rupees(data.totals.pending_paise)} · owed {rupees(data.totals.available_paise)} · paid {rupees(data.totals.paid_paise)}
          </p>
          <table className="min-w-full text-xs">
            <thead><tr className="text-left uppercase text-gray-500 border-b"><th className="py-1 pr-3">From</th><th className="py-1 pr-3">Promoter</th><th className="py-1 pr-3">Scheme</th><th className="py-1 pr-3">Rate</th><th className="py-1 pr-3">Duration</th><th className="py-1">Reason</th></tr></thead>
            <tbody>{data.terms.map(t => (
              <tr key={t.id} className="border-b last:border-0 align-top">
                <td className="py-1 pr-3 whitespace-nowrap">{fmtDate(t.effective_from)}</td>
                <td className="py-1 pr-3">{t.promoter_name}</td>
                <td className="py-1 pr-3">{t.scheme_name} v{t.scheme_version}</td>
                <td className="py-1 pr-3">{t.override_rate_bps != null ? `${pct(t.override_rate_bps)} (override)` : t.locked_tier_rate_bps != null ? `${pct(t.locked_tier_rate_bps)} (tier)` : `${pct(t.base_rate_bps)}${Object.keys(t.plan_rates || {}).length ? ' + plan rates' : ''}${t.tiers?.length ? ` · ${t.tier_mode} tiers` : ''}`}</td>
                <td className="py-1 pr-3">{t.commission_months ? `${t.commission_months} months` : 'lifetime'}{t.months_overridden ? ' (override)' : ''}</td>
                <td className="py-1 text-gray-600">{t.reason}{t.created_by_name ? ` — ${t.created_by_name}` : ''}</td>
              </tr>
            ))}</tbody>
          </table>
          {r.status !== 'revoked' && (
            <div className="flex flex-wrap gap-3 text-sm pt-1">
              {r.status === 'flagged' && <button className="text-green-700 hover:underline" onClick={() => setModal({ type: 'status', action: 'clear_flag' })}>Clear flag</button>}
              {r.status === 'active' && <button className="text-orange-700 hover:underline" onClick={() => setModal({ type: 'status', action: 'flag' })}>Flag for review</button>}
              <button className="text-gray-700 hover:underline" onClick={() => setModal({ type: 'status', action: r.no_commission ? 'allow_commission' : 'no_commission' })}>{r.no_commission ? 'Allow commission' : 'Stop commission'}</button>
              <button className="text-red-600 hover:underline" onClick={() => setModal({ type: 'status', action: 'revoke' })}>Revoke referral</button>
            </div>
          )}
        </>
      )}

      {modal?.type === 'assign' && <AssignModal tenantId={tenantId} existing={r} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'terms' && <TermsModal tenantId={tenantId} data={data} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'status' && <StatusModal tenantId={tenantId} action={modal.action} onClose={() => setModal(null)} onDone={done} />}
    </div>
  );
}

function AssignModal({ tenantId, existing, onClose, onDone }) {
  const [promoters, setPromoters] = useState([]);
  const [q, setQ] = useState('');
  const [promoterId, setPromoterId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => promoterAdmin.promoters({ status: 'active', q: q || undefined }).then(r => setPromoters(r.data)).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q]);
  const submit = async () => {
    setError(null);
    try {
      await promoterAdmin.assignReferral(tenantId, { promoter_id: promoterId, reason, effective_from: existing ? effectiveFrom : undefined });
      onDone(existing ? 'Clinic reassigned' : 'Promoter assigned');
    } catch (err) { setError(apiError(err)); }
  };
  return (
    <Modal title={existing ? 'Reassign to another promoter' : 'Assign a promoter'} onClose={onClose}>
      {existing && <p className="text-sm text-gray-600">Commission for paid periods starting before the date stays with {existing.promoter_name}. Later periods go to the new promoter on their scheme.</p>}
      <ErrorBox error={error} />
      <Field label="Search promoters"><input className={inputClass} value={q} onChange={e => setQ(e.target.value)} placeholder="Name, email or code" /></Field>
      <Field label="Promoter" required>
        <select className={inputClass} value={promoterId} onChange={e => setPromoterId(e.target.value)}>
          <option value="">Choose…</option>
          {promoters.filter(p => p.id !== existing?.promoter_id).map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
        </select>
      </Field>
      {existing && <Field label="From paid periods starting"><input type="date" className={inputClass} value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} /></Field>}
      <Field label="Reason" required><input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={submit} disabled={!promoterId || !reason.trim()}>Save</button></div>
    </Modal>
  );
}

function TermsModal({ tenantId, data, onClose, onDone }) {
  const latest = data.terms[0];
  const [schemes, setSchemes] = useState([]);
  const [form, setForm] = useState({
    effective_from: data.minTermsDate && data.minTermsDate > todayISO() ? data.minTermsDate : todayISO(),
    rate: fromBps(latest?.override_rate_bps), months_set: !!latest?.months_overridden, months: latest?.commission_months ?? '',
    scheme_id: '', reason: ''
  });
  const [error, setError] = useState(null);
  useEffect(() => { promoterAdmin.schemes().then(r => setSchemes(r.data.filter(s => s.is_active))).catch(() => {}); }, []);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const submit = async () => {
    setError(null);
    try {
      await promoterAdmin.referralTerms(tenantId, {
        effective_from: form.effective_from,
        override_rate_bps: String(form.rate).trim() === '' ? null : toBps(form.rate),
        months_set: form.months_set,
        commission_months: form.months_set ? (String(form.months).trim() === '' ? null : Number(form.months)) : null,
        scheme_id: form.scheme_id || undefined,
        reason: form.reason
      });
      onDone('New terms added');
    } catch (err) { setError(apiError(err)); }
  };
  return (
    <Modal title="Change commission terms for this clinic" onClose={onClose}>
      <p className="text-sm text-gray-600">Adds a new terms version. It applies to paid periods starting on or after the date. Existing commission never changes.{data.minTermsDate && ` Earliest allowed date: ${fmtDate(data.minTermsDate)}.`}</p>
      <ErrorBox error={error} />
      <Field label="Applies to periods starting"><input type="date" className={inputClass} value={form.effective_from} min={data.minTermsDate || undefined} onChange={set('effective_from')} /></Field>
      <Field label="Rate override (%)" hint="Empty = use the scheme"><input className={inputClass} value={form.rate} onChange={set('rate')} inputMode="decimal" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.months_set} onChange={set('months_set')} /> Override duration</label>
      {form.months_set && <Field label="Months (from the window start)" hint="Empty = lifetime"><input className={inputClass} value={form.months} onChange={set('months')} inputMode="numeric" /></Field>}
      <Field label="Move to another scheme (optional)"><select className={inputClass} value={form.scheme_id} onChange={set('scheme_id')}><option value="">Keep {latest?.scheme_name}</option>{schemes.map(s => <option key={s.id} value={s.id}>{s.name} ({pct(s.base_rate_bps)})</option>)}</select></Field>
      <Field label="Reason" required><input className={inputClass} value={form.reason} onChange={set('reason')} /></Field>
      <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={submit} disabled={!form.reason.trim()}>Add terms</button></div>
    </Modal>
  );
}

const STATUS_TEXT = {
  clear_flag: ['Clear flag', 'Commission on hold will be released normally.'],
  flag: ['Flag for review', 'Commission stays on hold until the flag is cleared.'],
  no_commission: ['Stop commission', 'The clinic stays attributed, but new payments earn nothing.'],
  allow_commission: ['Allow commission', 'New payments earn commission again. Missed payments are picked up by the nightly reconciliation.'],
  revoke: ['Revoke referral', 'All unpaid commission for this clinic is voided. This cannot be undone.']
};

function StatusModal({ tenantId, action, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [title, text] = STATUS_TEXT[action];
  const submit = async () => {
    setError(null);
    try { await promoterAdmin.referralStatus(tenantId, { action, reason }); onDone(title); } catch (err) { setError(apiError(err)); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-gray-600">{text}</p>
      <ErrorBox error={error} />
      <Field label="Reason" required><input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Cancel</button><button className={action === 'revoke' ? btnDanger : btnPrimary} onClick={submit} disabled={!reason.trim()}>{title}</button></div>
    </Modal>
  );
}

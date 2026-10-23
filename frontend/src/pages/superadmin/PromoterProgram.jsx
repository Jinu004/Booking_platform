// Super admin: Promoter Program (overview, promoters, schemes, payouts, settings, plans, audit log).
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { promoterAdmin } from '../../services/promoterAdmin.service';
import { Card, Stat, Badge, Field, ErrorBox, Modal, Empty, inputClass, btnPrimary, btnSecondary, apiError } from '../../partner/ui';
import { rupees, pct, fmtDate, fromPaise, toPaise } from '../../utils/money';
import SettingsTab from './promoter/SettingsTab';
import SchemesTab from './promoter/SchemesTab';
import PayoutsTab from './promoter/PayoutsTab';
import useStore from '../../store/useStore';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'promoters', label: 'Promoters' },
  { key: 'schemes', label: 'Schemes' },
  { key: 'payouts', label: 'Payouts' },
  { key: 'settings', label: 'Settings' },
  { key: 'plans', label: 'Plans & prices' },
  { key: 'audit', label: 'Audit log' }
];

export default function PromoterProgram() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'overview';
  return (
    <div className="p-0 md:p-8 space-y-6">
      <div className="space-y-2">
        <Link to="/superadmin" className="text-sm text-indigo-600 hover:text-indigo-900">← Platform Admin</Link>
        <h1 className="text-2xl font-bold text-gray-900">Promoter Program</h1>
      </div>
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setParams({ tab: t.key })}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${tab === t.key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'promoters' && <PromotersTab />}
      {tab === 'schemes' && <SchemesTab />}
      {tab === 'payouts' && <PayoutsTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'plans' && <PlansTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}

function OverviewTab() {
  const { addToast } = useStore();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = () => promoterAdmin.overview().then(r => setData(r.data)).catch(err => setError(apiError(err)));
  useEffect(() => { load(); }, []);

  const runJob = async () => {
    try {
      const r = await promoterAdmin.runDailyJob();
      addToast(`Released ${r.data.released ?? 0}, reconciled ${r.data.reconciled ?? 0}`, 'success');
      load();
    } catch (err) { setError(apiError(err)); }
  };

  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;
  return (
    <div className="space-y-6">
      {!data.program_enabled && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">The program is <b>off</b>: partner sign-up is closed and referral codes are not captured. Turn it on in <Link className="underline" to="?tab=settings">Settings</Link>.</div>}
      {data.freeze_accruals && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Commission accruals are <b>frozen</b>. Payments are recorded but earn no commission until you unfreeze them in Settings.</div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Active promoters" value={data.active_promoters} />
        <Stat label="Applications" value={data.pending_applications} tone={data.pending_applications ? 'amber' : 'default'} />
        <Stat label="KYC to review" value={data.kyc_to_review} tone={data.kyc_to_review ? 'amber' : 'default'} />
        <Stat label="Referred clinics" value={data.referred_clinics} />
        <Stat label="On hold" value={rupees(data.pending_paise)} />
        <Stat label="Owed (available)" value={rupees(data.available_paise)} tone="indigo" />
        <Stat label="Paid this month" value={rupees(data.paid_this_month_paise)} tone="green" />
        <Stat label="Open payouts" value={data.open_payouts} hint={`Settings version ${data.settings_version}`} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Flagged referrals" actions={<span className="text-xs text-gray-500">No release until cleared</span>}>
          {!data.flagged.length ? <Empty>Nothing flagged.</Empty> : (
            <ul className="divide-y text-sm">{data.flagged.map(f => (
              <li key={f.tenant_id || f.tenant_name} className="py-2">
                {f.tenant_id ? <Link to={`/superadmin/tenants/${f.tenant_id}`} className="font-medium text-indigo-600 hover:underline">{f.tenant_name}</Link> : <span className="font-medium">{f.tenant_name}</span>}
                <span className="text-gray-500"> · {f.promoter_name}</span>
                <div className="text-xs text-gray-500">{f.flag_reason}</div>
              </li>
            ))}</ul>
          )}
        </Card>
        <Card title="Top promoters">
          {!data.top_promoters.length ? <Empty>No promoters yet.</Empty> : (
            <table className="min-w-full text-sm"><tbody>{data.top_promoters.map(p => (
              <tr key={p.id} className="border-b last:border-0"><td className="py-2"><Link to={`/superadmin/promoters/${p.id}`} className="text-indigo-600 hover:underline">{p.name}</Link> <span className="text-xs text-gray-500 font-mono">{p.code}</span></td>
                <td className="py-2 text-gray-600">{p.clinics} clinics</td><td className="py-2 text-right font-medium">{rupees(p.earned_paise)}</td></tr>
            ))}</tbody></table>
          )}
        </Card>
      </div>
      <div className="text-right"><button className={btnSecondary} onClick={runJob}>Run release &amp; reconcile now</button></div>
    </div>
  );
}

function PromotersTab() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = () => promoterAdmin.promoters({ status, q: q || undefined }).then(r => setRows(r.data)).catch(err => setError(apiError(err)));
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [status, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Status">
          <select className={inputClass} value={status} onChange={e => setStatus(e.target.value)}>
            {['all', 'pending', 'active', 'suspended', 'terminated', 'rejected'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Search"><input className={inputClass} value={q} onChange={e => setQ(e.target.value)} placeholder="Name, email, phone or code" /></Field>
        <button className={`${btnPrimary} ml-auto`} onClick={() => setCreating(true)}>+ Add promoter</button>
      </div>
      <ErrorBox error={error} />
      <Card>
        {!rows ? <p className="text-sm text-gray-500">Loading…</p> : !rows.length ? <Empty>No promoters.</Empty> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-gray-500 border-b">
                <th className="py-2 pr-3">Promoter</th><th className="py-2 pr-3">Code</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Scheme</th>
                <th className="py-2 pr-3">Clinics</th><th className="py-2 pr-3 text-right">On hold</th><th className="py-2 pr-3 text-right">Owed</th><th className="py-2 text-right">Paid</th>
              </tr></thead>
              <tbody>
                {rows.map(p => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/superadmin/promoters/${p.id}`)}>
                    <td className="py-2 pr-3"><div className="font-medium text-gray-900">{p.name}</div><div className="text-xs text-gray-500">{p.email} · {p.phone}</div></td>
                    <td className="py-2 pr-3 font-mono">{p.code}</td>
                    <td className="py-2 pr-3 space-x-1"><Badge status={p.status} /><Badge status={p.kyc_status} label={`KYC ${p.kyc_status.replace('_', ' ')}`} /></td>
                    <td className="py-2 pr-3">{p.scheme_name}{p.override_rate_bps != null && <span className="text-xs text-indigo-600"> · {pct(p.override_rate_bps)} override</span>}</td>
                    <td className="py-2 pr-3">{p.referral_count}{p.flagged_count > 0 && <span className="text-xs text-orange-600"> ({p.flagged_count} flagged)</span>}</td>
                    <td className="py-2 pr-3 text-right">{rupees(p.pending_paise)}</td>
                    <td className="py-2 pr-3 text-right">{rupees(p.available_paise)}</td>
                    <td className="py-2 text-right">{rupees(p.paid_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && <CreatePromoter onClose={() => setCreating(false)} onCreated={(p) => navigate(`/superadmin/promoters/${p.id}`)} />}
    </div>
  );
}

function CreatePromoter({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', city: '', scheme_id: '' });
  const [schemes, setSchemes] = useState([]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { promoterAdmin.schemes().then(r => setSchemes(r.data.filter(s => s.is_active))).catch(() => {}); }, []);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    setBusy(true); setError(null); setErrors({});
    try {
      const res = await promoterAdmin.createPromoter({ ...form, scheme_id: form.scheme_id || undefined });
      onCreated(res.data);
    } catch (err) { setError(apiError(err)); setErrors(err?.details || {}); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add promoter" onClose={onClose}>
      <p className="text-sm text-gray-600">The promoter is created as active and gets an email to set their password.</p>
      <ErrorBox error={error} />
      <Field label="Name" required error={errors.name}><input className={inputClass} value={form.name} onChange={set('name')} /></Field>
      <Field label="Email" required error={errors.email}><input className={inputClass} type="email" value={form.email} onChange={set('email')} /></Field>
      <Field label="Phone" required error={errors.phone}><input className={inputClass} value={form.phone} onChange={set('phone')} /></Field>
      <Field label="City"><input className={inputClass} value={form.city} onChange={set('city')} /></Field>
      <Field label="Scheme" hint="Empty = default scheme from settings">
        <select className={inputClass} value={form.scheme_id} onChange={set('scheme_id')}><option value="">Default</option>{schemes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </Field>
      <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={onClose}>Cancel</button><button className={btnPrimary} onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create'}</button></div>
    </Modal>
  );
}

function PlansTab() {
  const { addToast } = useStore();
  const [plans, setPlans] = useState(null);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const load = () => promoterAdmin.plans().then(r => setPlans(r.data)).catch(err => setError(apiError(err)));
  useEffect(() => { load(); }, []);

  const save = async () => {
    setError(null);
    const price = toPaise(edit.price);
    if (price === null || Number.isNaN(price)) { setError('Enter a valid price'); return; }
    try {
      await promoterAdmin.updatePlan(edit.id, { name: edit.name, monthly_price_paise: price, is_active: edit.is_active, reason: edit.reason });
      addToast('Plan saved', 'success'); setEdit(null); load();
    } catch (err) { setError(apiError(err)); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">These prices are shown on the sign-up page and used for revenue figures. Changing a price does not change payments already recorded; commission is always calculated from the amount actually paid.</p>
      <ErrorBox error={!edit && error} />
      <Card>
        {!plans ? <p className="text-sm text-gray-500">Loading…</p> : (
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-gray-500 border-b"><th className="py-2">Plan</th><th className="py-2">Monthly price</th><th className="py-2">Status</th><th className="py-2">Updated</th><th /></tr></thead>
            <tbody>{plans.map(p => (
              <tr key={p.id} className="border-b last:border-0"><td className="py-2 font-medium">{p.name} <span className="text-xs text-gray-500 font-mono">{p.id}</span></td>
                <td className="py-2">{rupees(p.monthly_price_paise, { decimals: 0 })}</td><td className="py-2"><Badge status={p.is_active ? 'active' : 'cancelled'} label={p.is_active ? 'Active' : 'Hidden'} /></td>
                <td className="py-2 text-gray-500">{fmtDate(p.updated_at)}</td>
                <td className="py-2 text-right"><button className="text-indigo-600 hover:underline" onClick={() => { setError(null); setEdit({ ...p, price: fromPaise(p.monthly_price_paise), reason: '' }); }}>Edit</button></td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      {edit && (
        <Modal title={`Edit plan: ${edit.id}`} onClose={() => setEdit(null)}>
          <ErrorBox error={error} />
          <Field label="Name"><input className={inputClass} value={edit.name} onChange={e => setEdit(x => ({ ...x, name: e.target.value }))} /></Field>
          <Field label="Monthly price (₹)"><input className={inputClass} value={edit.price} onChange={e => setEdit(x => ({ ...x, price: e.target.value }))} inputMode="decimal" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.is_active} onChange={e => setEdit(x => ({ ...x, is_active: e.target.checked }))} /> Shown on the sign-up page</label>
          <Field label="Reason" required><input className={inputClass} value={edit.reason} onChange={e => setEdit(x => ({ ...x, reason: e.target.value }))} /></Field>
          <div className="flex justify-end gap-2"><button className={btnSecondary} onClick={() => setEdit(null)}>Cancel</button><button className={btnPrimary} onClick={save} disabled={!edit.reason.trim()}>Save</button></div>
        </Modal>
      )}
    </div>
  );
}

function AuditTab() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { promoterAdmin.audit({ limit: 300 }).then(r => setRows(r.data)).catch(err => setError(apiError(err))); }, []);
  if (error) return <ErrorBox error={error} />;
  return (
    <Card>
      {!rows ? <p className="text-sm text-gray-500">Loading…</p> : !rows.length ? <Empty>No entries yet.</Empty> : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead><tr className="text-left uppercase text-gray-500 border-b"><th className="py-2 pr-3">When</th><th className="py-2 pr-3">Who</th><th className="py-2 pr-3">Action</th><th className="py-2 pr-3">Promoter</th><th className="py-2 pr-3">Reason</th><th className="py-2">Change</th></tr></thead>
            <tbody>{rows.map(a => (
              <tr key={a.id} className="border-b last:border-0 align-top">
                <td className="py-1.5 pr-3 whitespace-nowrap">{new Date(a.created_at).toLocaleString('en-IN')}</td>
                <td className="py-1.5 pr-3">{a.actor_name || a.actor_type}</td>
                <td className="py-1.5 pr-3 font-mono">{a.action}</td>
                <td className="py-1.5 pr-3">{a.promoter_name || '—'}</td>
                <td className="py-1.5 pr-3">{a.reason || '—'}</td>
                <td className="py-1.5 font-mono text-gray-600 break-all max-w-md">{a.after ? JSON.stringify(a.after).slice(0, 200) : ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// Commission schemes: reusable, versioned commission terms (rate, duration, per-plan rates, tiers,
// bonus, cap). Saving creates a new version; the admin chooses whether it applies to new referrals
// only or also to existing referrals from a date, after an impact preview.
import React, { useEffect, useState } from 'react';
import { promoterAdmin } from '../../../services/promoterAdmin.service';
import { Card, Field, ErrorBox, Modal, Badge, inputClass, btnPrimary, btnSecondary, apiError } from '../../../partner/ui';
import { rupees, pct, fromBps, toBps, fromPaise, toPaise, fmtDate, todayISO } from '../../../utils/money';
import useStore from '../../../store/useStore';

function describe(s) {
  const parts = [`${pct(s.base_rate_bps)} base`, s.commission_months ? `${s.commission_months} months` : 'lifetime'];
  const pr = Object.entries(s.plan_rates || {});
  if (pr.length) parts.push(pr.map(([p, r]) => `${p} ${pct(r)}`).join(', '));
  if (s.tiers?.length) parts.push(`${s.tiers.length} tiers (${s.tier_mode})`);
  if (s.first_payment_bonus_paise) parts.push(`${rupees(s.first_payment_bonus_paise, { decimals: 0 })} bonus`);
  if (s.monthly_cap_paise) parts.push(`cap ${rupees(s.monthly_cap_paise, { decimals: 0 })}/month`);
  return parts.join(' · ');
}

function toForm(v, plans) {
  return {
    base_rate: fromBps(v?.base_rate_bps ?? 2000),
    months: v?.commission_months == null ? (v ? '' : '12') : String(v.commission_months),
    tier_mode: v?.tier_mode || 'locked',
    plan_rates: Object.fromEntries(plans.map(p => [p.id, v?.plan_rates?.[p.id] != null ? fromBps(v.plan_rates[p.id]) : ''])),
    tiers: (v?.tiers || []).map(t => ({ min_active: String(t.min_active), rate: fromBps(t.rate_bps) })),
    bonus: v?.first_payment_bonus_paise != null ? fromPaise(v.first_payment_bonus_paise) : '',
    cap: v?.monthly_cap_paise != null ? fromPaise(v.monthly_cap_paise) : ''
  };
}

function fromForm(f) {
  const plan_rates = {};
  for (const [k, v] of Object.entries(f.plan_rates)) if (String(v).trim() !== '') plan_rates[k] = toBps(v);
  return {
    base_rate_bps: toBps(f.base_rate),
    commission_months: String(f.months).trim() === '' ? null : Number(f.months),
    tier_mode: f.tier_mode,
    plan_rates,
    tiers: f.tiers.map(t => ({ min_active: Number(t.min_active), rate_bps: toBps(t.rate) })),
    first_payment_bonus_paise: String(f.bonus).trim() === '' ? null : toPaise(f.bonus),
    monthly_cap_paise: String(f.cap).trim() === '' ? null : toPaise(f.cap)
  };
}

function SchemeEditor({ scheme, plans, onClose, onSaved }) {
  const { addToast } = useStore();
  const isNew = !scheme;
  const current = scheme?.versions?.[0];
  const [form, setForm] = useState(() => toForm(current, plans));
  const [meta, setMeta] = useState({ name: scheme?.name || '', description: scheme?.description || '', is_active: scheme?.is_active ?? true });
  const [applyTo, setApplyTo] = useState('new');
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const valuesChanged = isNew || JSON.stringify(fromForm(form)) !== JSON.stringify(fromForm(toForm(current, plans)));
  const metaChanged = !isNew && (meta.name !== scheme.name || (meta.description || '') !== (scheme.description || '') || meta.is_active !== scheme.is_active);

  const runPreview = async () => {
    setError(null); setErrors({});
    if (isNew) return;
    try {
      const res = await promoterAdmin.previewScheme(scheme.id, { values: fromForm(form), applyTo });
      if (Object.keys(res.data.errors || {}).length) setErrors(res.data.errors);
      setPreview(res.data);
    } catch (err) { setError(apiError(err)); }
  };

  useEffect(() => { if (!isNew && valuesChanged) runPreview(); else setPreview(null); /* eslint-disable-next-line */ }, [applyTo]);

  const save = async () => {
    setSaving(true); setError(null); setErrors({});
    try {
      if (isNew) {
        await promoterAdmin.createScheme({ name: meta.name, description: meta.description, values: fromForm(form), reason });
      } else {
        await promoterAdmin.saveScheme(scheme.id, {
          values: valuesChanged ? fromForm(form) : undefined,
          name: metaChanged ? meta.name : undefined,
          description: metaChanged ? meta.description : undefined,
          isActive: metaChanged ? meta.is_active : undefined,
          baseVersion: current.version, reason, applyTo, effectiveFrom
        });
      }
      addToast('Scheme saved', 'success');
      onSaved();
    } catch (err) {
      setError(apiError(err)); setErrors(err?.details || {});
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isNew ? 'New commission scheme' : `Edit “${scheme.name}” (v${current.version})`} onClose={onClose} wide>
      <ErrorBox error={error} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Name" required><input className={inputClass} value={meta.name} onChange={e => setMeta(m => ({ ...m, name: e.target.value }))} /></Field>
        <Field label="Description"><input className={inputClass} value={meta.description} onChange={e => setMeta(m => ({ ...m, description: e.target.value }))} /></Field>
        {!isNew && (
          <label className="flex items-center gap-2 text-sm text-gray-700 md:col-span-2">
            <input type="checkbox" checked={meta.is_active} onChange={e => setMeta(m => ({ ...m, is_active: e.target.checked }))} />
            Active (inactive schemes cannot be given to new promoters)
          </label>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t">
        <Field label="Base rate (%)" required error={errors.base_rate_bps}><input className={inputClass} value={form.base_rate} onChange={set('base_rate')} inputMode="decimal" /></Field>
        <Field label="Duration (months)" error={errors.commission_months} hint="Empty = lifetime"><input className={inputClass} value={form.months} onChange={set('months')} inputMode="numeric" /></Field>
        <Field label="Tier mode" error={errors.tier_mode} hint="Locked: clinic keeps the tier rate it was referred at. Live: rate follows the promoter's current tier.">
          <select className={inputClass} value={form.tier_mode} onChange={set('tier_mode')}><option value="locked">Locked at referral</option><option value="live">Live at each payment</option></select>
        </Field>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-700 mb-1">Per-plan rate (%) <span className="text-xs text-gray-500 font-normal">— optional, overrides tiers and base rate for that plan</span></p>
        <div className="grid grid-cols-3 gap-3">
          {plans.map(p => (
            <Field key={p.id} label={p.name}><input className={inputClass} value={form.plan_rates[p.id] ?? ''} onChange={e => setForm(f => ({ ...f, plan_rates: { ...f.plan_rates, [p.id]: e.target.value } }))} inputMode="decimal" placeholder="—" /></Field>
          ))}
        </div>
        {errors.plan_rates && <p className="text-xs text-red-600 mt-1">{errors.plan_rates}</p>}
      </div>
      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">Tiers <span className="text-xs text-gray-500 font-normal">— by active paying clinics last month; first tier starts at 0</span></p>
          <button type="button" className="text-sm text-indigo-600 hover:underline" onClick={() => setForm(f => ({ ...f, tiers: [...f.tiers, { min_active: f.tiers.length ? '' : '0', rate: '' }] }))}>+ Add tier</button>
        </div>
        {form.tiers.map((t, i) => (
          <div key={i} className="flex items-center gap-2 mt-2">
            <span className="text-sm text-gray-500 w-16">From</span>
            <input className={`${inputClass} w-24`} value={t.min_active} onChange={e => setForm(f => ({ ...f, tiers: f.tiers.map((x, j) => j === i ? { ...x, min_active: e.target.value } : x) }))} inputMode="numeric" />
            <span className="text-sm text-gray-500">clinics →</span>
            <input className={`${inputClass} w-24`} value={t.rate} onChange={e => setForm(f => ({ ...f, tiers: f.tiers.map((x, j) => j === i ? { ...x, rate: e.target.value } : x) }))} inputMode="decimal" />
            <span className="text-sm text-gray-500">%</span>
            <button type="button" className="text-red-600 text-sm ml-auto" onClick={() => setForm(f => ({ ...f, tiers: f.tiers.filter((_, j) => j !== i) }))}>Remove</button>
          </div>
        ))}
        {errors.tiers && <p className="text-xs text-red-600 mt-1">{errors.tiers}</p>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="One-time bonus per clinic (₹)" error={errors.first_payment_bonus_paise} hint="Paid after the clinic's first payment. Empty = none"><input className={inputClass} value={form.bonus} onChange={set('bonus')} inputMode="decimal" /></Field>
        <Field label="Cap per clinic per month (₹)" error={errors.monthly_cap_paise} hint="Empty = no cap"><input className={inputClass} value={form.cap} onChange={set('cap')} inputMode="decimal" /></Field>
      </div>

      {!isNew && valuesChanged && (
        <div className="border-t pt-3 space-y-3">
          <p className="text-sm font-medium text-gray-700">Apply the new values to</p>
          <label className="flex items-center gap-2 text-sm"><input type="radio" checked={applyTo === 'new'} onChange={() => setApplyTo('new')} /> Clinics referred from now on only (existing clinics keep their terms)</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" checked={applyTo === 'existing'} onChange={() => setApplyTo('existing')} /> Also existing clinics on this scheme, for paid periods starting from
            <input type="date" className="border border-gray-300 rounded px-2 py-1 text-sm" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} disabled={applyTo !== 'existing'} />
          </label>
          <button type="button" className={btnSecondary} onClick={runPreview}>Preview impact</button>
          {preview && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm space-y-2">
              <p className="text-gray-700">{preview.note}</p>
              {preview.samples?.length > 0 && (
                <table className="text-xs w-full"><thead><tr className="text-left text-gray-500"><th>Plan (monthly)</th><th>Now</th><th>New</th></tr></thead>
                  <tbody>{preview.samples.map(s => <tr key={s.plan}><td>{s.plan} ({rupees(s.monthly_price_paise, { decimals: 0 })})</td><td>{rupees(s.current_paise)}</td><td className="font-semibold">{rupees(s.proposed_paise)}</td></tr>)}</tbody>
                </table>
              )}
              <p className="text-xs text-gray-500">Samples use the first tier. Commissions already created never change.</p>
            </div>
          )}
        </div>
      )}

      <Field label="Reason" required hint="Saved with this version and in the audit log."><input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <div className="flex justify-end gap-2">
        <button className={btnSecondary} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} onClick={save} disabled={saving || !reason.trim() || !meta.name.trim() || (!isNew && !valuesChanged && !metaChanged)}>{saving ? 'Saving…' : isNew ? 'Create scheme' : valuesChanged ? `Save as version ${current.version + 1}` : 'Save'}</button>
      </div>
    </Modal>
  );
}

export default function SchemesTab() {
  const [schemes, setSchemes] = useState(null);
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // 'new' or scheme detail
  const [expanded, setExpanded] = useState(null);

  const load = async () => {
    try {
      const [s, p] = await Promise.all([promoterAdmin.schemes(), promoterAdmin.plans()]);
      setSchemes(s.data); setPlans(p.data);
    } catch (err) { setError(apiError(err)); }
  };
  useEffect(() => { load(); }, []);

  const openEdit = async (id) => {
    try { setEditing((await promoterAdmin.scheme(id)).data); } catch (err) { setError(apiError(err)); }
  };
  const toggleHistory = async (id) => {
    if (expanded?.id === id) { setExpanded(null); return; }
    try { setExpanded((await promoterAdmin.scheme(id)).data); } catch (err) { setError(apiError(err)); }
  };

  if (!schemes) return error ? <ErrorBox error={error} /> : <p className="text-sm text-gray-500">Loading…</p>;
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-600">Each promoter is on one scheme. Rates and durations can be overridden per promoter or per clinic.</p>
        <button className={btnPrimary} onClick={() => setEditing('new')}>+ New scheme</button>
      </div>
      <ErrorBox error={error} />
      {schemes.map(s => (
        <Card key={s.id} title={<span>{s.name} <span className="text-xs font-normal text-gray-500">v{s.version}</span> {!s.is_active && <Badge status="cancelled" label="Inactive" />}</span>}
          actions={<div className="flex gap-3 text-sm"><button className="text-indigo-600 hover:underline" onClick={() => toggleHistory(s.id)}>{expanded?.id === s.id ? 'Hide history' : 'History'}</button><button className="text-indigo-600 hover:underline" onClick={() => openEdit(s.id)}>Edit</button></div>}>
          <p className="text-sm text-gray-700">{describe(s)}</p>
          {s.description && <p className="text-xs text-gray-500 mt-1">{s.description}</p>}
          <p className="text-xs text-gray-500 mt-1">{s.promoter_count} promoter{s.promoter_count === 1 ? '' : 's'}</p>
          {s.tiers?.length > 0 && <p className="text-xs text-gray-500 mt-1">Tiers: {s.tiers.map(t => `${t.min_active}+ clinics ${pct(t.rate_bps)}`).join(' · ')}</p>}
          {expanded?.id === s.id && (
            <ul className="mt-3 border-t pt-3 space-y-2 text-xs text-gray-600">
              <li>Used by {expanded.usage.promoters} promoters and {expanded.usage.referrals} referred clinics.</li>
              {expanded.versions.map(v => (
                <li key={v.id}><b>v{v.version}</b> · {fmtDate(v.created_at)} · {v.created_by_name || 'system'} — {describe(v)} — “{v.reason}”</li>
              ))}
            </ul>
          )}
        </Card>
      ))}
      {editing && (
        <SchemeEditor scheme={editing === 'new' ? null : editing} plans={plans} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setExpanded(null); load(); }} />
      )}
    </div>
  );
}

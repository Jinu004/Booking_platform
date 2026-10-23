// Program settings: a form generated from the settings schema served by the backend, saved as a new
// version with a reason. Shows when each change takes effect, an impact preview, and version history.
import React, { useEffect, useMemo, useState } from 'react';
import { promoterAdmin } from '../../../services/promoterAdmin.service';
import { Card, Field, ErrorBox, Modal, inputClass, btnPrimary, btnSecondary, apiError } from '../../../partner/ui';
import { fromPaise, toPaise, fromBps, toBps, fmtDate } from '../../../utils/money';
import useStore from '../../../store/useStore';

function display(field, value) {
  if (value === null || value === undefined) return '—';
  if (field?.type === 'money') return `₹${fromPaise(value)}`;
  if (field?.type === 'bps') return `${fromBps(value)}%`;
  if (field?.type === 'boolean') return value ? 'On' : 'Off';
  if (Array.isArray(value)) return value.join(', ') || 'none';
  if (field?.type === 'longtext') return `${String(value).slice(0, 60)}${String(value).length > 60 ? '…' : ''}`;
  if (field?.options) return field.options.find(o => o.value === value)?.label || String(value);
  return String(value);
}

// Converts the raw value to what the input shows, and back
const toInput = (f, v) => f.type === 'money' ? fromPaise(v) : f.type === 'bps' ? fromBps(v) : v;
const fromInput = (f, v) => {
  if (f.type === 'money') return toPaise(v);
  if (f.type === 'bps') return toBps(v);
  if (f.type === 'integer') return v === '' ? NaN : Number(v);
  return v;
};

function FieldInput({ field, value, onChange, schemes }) {
  const f = field;
  if (f.type === 'boolean') {
    return (
      <label className="inline-flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} className="h-4 w-4" />
        <span className="text-sm text-gray-700">{value ? 'On' : 'Off'}</span>
      </label>
    );
  }
  if (f.type === 'enum') {
    return <select className={inputClass} value={value} onChange={e => onChange(e.target.value)}>{f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  }
  if (f.type === 'scheme') {
    return <select className={inputClass} value={value} onChange={e => onChange(e.target.value)}>{schemes.filter(s => s.is_active || s.id === value).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>;
  }
  if (f.type === 'multiselect') {
    const arr = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-wrap gap-3">
        {f.options.map(o => (
          <label key={o.value} className="inline-flex items-center gap-1.5 text-sm text-gray-700 capitalize">
            <input type="checkbox" checked={arr.includes(o.value)} onChange={e => onChange(e.target.checked ? [...arr, o.value] : arr.filter(x => x !== o.value))} />
            {o.label}
          </label>
        ))}
      </div>
    );
  }
  if (f.type === 'longtext') {
    return <textarea className={`${inputClass} font-mono`} rows={10} value={value} onChange={e => onChange(e.target.value)} maxLength={f.maxLength || undefined} />;
  }
  // text, integer, money (rupees) and bps (percent): `value` is already the string shown in the input
  const suffix = f.type === 'bps' ? '%' : null;
  const prefix = f.type === 'money' ? '₹' : null;
  return (
    <div className="flex items-center gap-2">
      {prefix && <span className="text-sm text-gray-500">{prefix}</span>}
      <input className={inputClass} value={value ?? ''} inputMode={f.type === 'text' ? 'text' : 'decimal'}
        onChange={e => onChange(e.target.value)} />
      {suffix && <span className="text-sm text-gray-500">{suffix}</span>}
    </div>
  );
}

export default function SettingsTab() {
  const { addToast } = useStore();
  const [schema, setSchema] = useState(null);
  const [current, setCurrent] = useState(null);
  const [schemes, setSchemes] = useState([]);
  const [draft, setDraft] = useState({}); // key → input string/value as typed
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [review, setReview] = useState(null); // preview result before save
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState(null);

  const load = async () => {
    setError(null);
    try {
      const [s, c, sc] = await Promise.all([promoterAdmin.settingsSchema(), promoterAdmin.settings(), promoterAdmin.schemes()]);
      setSchema(s.data); setCurrent(c.data); setSchemes(sc.data); setDraft({}); setFieldErrors({});
    } catch (err) {
      setError(apiError(err, 'Could not load settings'));
    }
  };
  useEffect(() => { load(); }, []);

  const fieldMap = useMemo(() => Object.fromEntries((schema?.fields || []).map(f => [f.key, f])), [schema]);

  // Typed values for fields the admin changed
  const changes = useMemo(() => {
    const out = {};
    for (const [k, raw] of Object.entries(draft)) {
      const f = fieldMap[k];
      if (!f) continue;
      const v = ['money', 'bps', 'integer'].includes(f.type) ? fromInput(f, raw) : raw;
      if (JSON.stringify(v) !== JSON.stringify(current.settings[k])) out[k] = v;
    }
    return out;
  }, [draft, fieldMap, current]);

  if (error && !schema) return <ErrorBox error={error} />;
  if (!schema || !current) return <p className="text-sm text-gray-500">Loading…</p>;

  // Number-like inputs keep the typed string in `draft`; it is converted when building `changes`
  const setValue = (f, v) => setDraft(d => ({ ...d, [f.key]: v }));
  const inputValue = (f) => {
    if (Object.prototype.hasOwnProperty.call(draft, f.key)) return draft[f.key];
    const v = current.settings[f.key];
    if (['money', 'bps'].includes(f.type)) return toInput(f, v);
    if (f.type === 'integer') return String(v);
    return v;
  };

  const invalidLocal = Object.entries(changes).filter(([, v]) => typeof v === 'number' && Number.isNaN(v)).map(([k]) => k);

  const openReview = async () => {
    setError(null); setFieldErrors({});
    if (invalidLocal.length) { setFieldErrors(Object.fromEntries(invalidLocal.map(k => [k, 'Enter a valid number']))); return; }
    try {
      const res = await promoterAdmin.previewSettings(changes);
      if (Object.keys(res.data.errors || {}).length) { setFieldErrors(res.data.errors); return; }
      setReview(res.data); setReason('');
    } catch (err) {
      setError(apiError(err));
    }
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      await promoterAdmin.saveSettings({ changes, baseVersion: current.version, reason });
      addToast('Settings saved', 'success');
      setReview(null);
      await load();
    } catch (err) {
      setReview(null);
      setError(apiError(err));
      setFieldErrors(err?.details || {});
    } finally {
      setSaving(false);
    }
  };

  const openHistory = async () => {
    try { setHistory((await promoterAdmin.settingsHistory()).data); } catch (err) { setError(apiError(err)); }
  };

  const restore = (version) => {
    const d = {};
    for (const f of schema.fields) {
      const v = version.settings[f.key];
      if (JSON.stringify(v) !== JSON.stringify(current.settings[f.key])) {
        d[f.key] = ['money', 'bps'].includes(f.type) ? toInput(f, v) : f.type === 'integer' ? String(v) : v;
      }
    }
    setDraft(d); setHistory(null);
    addToast(`Loaded version ${version.version}. Review and save to restore it.`, 'success');
  };

  const dirty = Object.keys(changes).length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 sticky top-0 z-10 bg-white/95 backdrop-blur border border-gray-200 rounded-lg px-4 py-2">
        <p className="text-sm text-gray-600">Version {current.version} · saved {fmtDate(current.created_at)} — “{current.reason}”</p>
        <div className="flex gap-2">
          <button className={btnSecondary} onClick={openHistory}>History</button>
          <button className={btnSecondary} onClick={() => { setDraft({}); setFieldErrors({}); }} disabled={!dirty}>Discard</button>
          <button className={btnPrimary} onClick={openReview} disabled={!dirty}>Review {dirty ? `${Object.keys(changes).length} change${Object.keys(changes).length > 1 ? 's' : ''}` : 'changes'}</button>
        </div>
      </div>
      <ErrorBox error={error} />

      {schema.groups.map(g => {
        const fields = schema.fields.filter(f => f.group === g.key);
        if (!fields.length) return null;
        return (
          <Card key={g.key} title={g.label}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
              {fields.map(f => (
                <div key={f.key} className={f.type === 'longtext' ? 'md:col-span-2' : ''}>
                  <Field label={<>{f.label}{changes[f.key] !== undefined && <span className="ml-2 text-xs text-indigo-600">changed</span>}</>} error={fieldErrors[f.key]}>
                    <FieldInput field={f} value={inputValue(f)} schemes={schemes} onChange={(v) => setValue(f, v)} />
                  </Field>
                  {f.help && <p className="text-xs text-gray-500 mt-1">{f.help}</p>}
                  <p className="text-xs text-gray-400 mt-0.5">Takes effect: {f.effect}</p>
                </div>
              ))}
            </div>
          </Card>
        );
      })}

      {review && (
        <Modal title="Review changes" onClose={() => setReview(null)} wide>
          <ul className="space-y-2 text-sm">
            {Object.entries(review.changed).map(([k, c]) => (
              <li key={k} className="border border-gray-200 rounded-lg p-3">
                <div className="font-medium text-gray-900">{fieldMap[k]?.label}{fieldMap[k]?.risky && <span className="ml-2 text-xs text-red-600">high impact</span>}</div>
                <div className="text-gray-600">{display(fieldMap[k], c.from)} → <span className="font-semibold">{display(fieldMap[k], c.to)}</span></div>
                <div className="text-xs text-gray-500">Takes effect: {fieldMap[k]?.effect}</div>
              </li>
            ))}
          </ul>
          {review.notes.filter(n => !Object.values(fieldMap).some(f => n.startsWith(f.label + ':'))).map((n, i) => (
            <p key={i} className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{n}</p>
          ))}
          <Field label="Reason for this change" required hint="Saved in the settings history and the audit log.">
            <input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} autoFocus />
          </Field>
          <div className="flex justify-end gap-2">
            <button className={btnSecondary} onClick={() => setReview(null)}>Back</button>
            <button className={btnPrimary} onClick={save} disabled={saving || !reason.trim()}>{saving ? 'Saving…' : `Save as version ${current.version + 1}`}</button>
          </div>
        </Modal>
      )}

      {history && (
        <Modal title="Settings history" onClose={() => setHistory(null)} wide>
          <ul className="space-y-3">
            {history.map((h, i) => {
              const prev = history[i + 1];
              const diffs = prev ? schema.fields.filter(f => JSON.stringify(h.settings[f.key]) !== JSON.stringify(prev.settings[f.key])) : [];
              return (
                <li key={h.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-semibold">Version {h.version}{h.version === current.version && ' (current)'}</span>
                    <span className="text-gray-500">{new Date(h.created_at).toLocaleString('en-IN')} · {h.created_by_name || 'system'}</span>
                  </div>
                  <p className="text-gray-600 mt-1">“{h.reason}”</p>
                  {diffs.length > 0 && (
                    <ul className="mt-2 text-xs text-gray-600 space-y-0.5">
                      {diffs.map(f => <li key={f.key}>{f.label}: {display(f, prev.settings[f.key])} → <b>{display(f, h.settings[f.key])}</b></li>)}
                    </ul>
                  )}
                  {h.version !== current.version && <button className="mt-2 text-indigo-600 hover:underline text-xs" onClick={() => restore(h)}>Restore these values…</button>}
                </li>
              );
            })}
          </ul>
        </Modal>
      )}
    </div>
  );
}

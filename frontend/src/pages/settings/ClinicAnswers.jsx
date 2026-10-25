import React, { useState, useEffect } from 'react';
import Modal from '../../components/shared/Modal';
import { CardSkeleton } from '../../components/shared/Skeleton';
import LoadError from '../../components/LoadError';
import useStore from '../../store/useStore';
import { getErrorMessage } from '../../utils/errorMessage';
import { plural } from '../../utils/plural';
import {
  getHITLSettings, updateHITLSettings, getClinicSettings, updateClinicSettings,
  getAiFaq, updateAiFaq,
  getTreatments, createTreatment, updateTreatment, deleteTreatment,
  getOffers, createOffer, updateOffer, deleteOffer,
  getUnansweredQuestions, resolveUnansweredQuestion
} from '../../services/settings.service';

// The "Clinic answers" tab of Settings: guided answers, treatments, offers and the questions the AI could not answer.
// Admin and manager only (Settings.jsx decides who sees the tab). Writes need the Growth or Pro plan: other plans see a lock card
// and nothing is loaded. Every section loads on its own; a failed load shows a retry, and a failed save never clears what was typed.

const MAX_TREATMENTS = 60;
const MAX_OFFERS = 20;
const MAX_QA = 10;

// The Basics section is BasicsSection below (it uses the clinic's existing phone and address); these are the other short-answer sections
const FAQ_SECTIONS = [
  {
    id: 'policies',
    title: 'Payments and policies',
    fields: [
      { key: 'payment_methods', label: 'Payment methods accepted', max: 400, rows: 3 },
      { key: 'cancellation_policy', label: 'Cancellation and rescheduling', max: 400, rows: 3 },
      { key: 'emergency_instructions', label: 'What patients should do in an emergency', max: 400, rows: 3 },
      { key: 'closed_days', label: 'Holidays and closed days', max: 400, rows: 3 }
    ]
  },
  {
    id: 'facilities',
    title: 'Facilities and languages',
    fields: [
      { key: 'facilities', label: 'Lab or pharmacy on site, other facilities', max: 400, rows: 3 },
      { key: 'staff_languages', label: 'Languages your staff speak', max: 400, rows: 2 }
    ]
  },
  {
    id: 'staff',
    title: 'Always send to staff',
    fields: [
      { key: 'never_answer', label: 'Topics the AI must never answer, one per line', max: 400, rows: 3 }
    ],
    note: 'The AI will pass these to your team.'
  }
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-10-25" -> "25 Oct 2026" (plain text parsing: no time zone shift)
const formatDate = (text) => {
  const [y, m, d] = String(text || '').split('-').map(Number);
  if (!y || !m || !d) return String(text || '');
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

// Today's date in India as YYYY-MM-DD
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

// "5 minutes ago", "3 hours ago", "2 days ago"
const timeAgo = (iso) => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${plural(hours, 'hour')} ago`;
  return `${plural(Math.floor(hours / 24), 'day')} ago`;
};

const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
const primaryButton = 'px-5 py-2 min-h-[40px] md:min-h-0 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50';
const outlineButton = 'px-3 py-2 min-h-[40px] md:min-h-0 text-sm font-semibold text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50';
const dangerButton = 'px-3 py-2 min-h-[40px] md:min-h-0 text-sm font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50';

// A text field with its character counter. rows 0 = a single line.
function TextField({ id, label, value, onChange, max, rows = 0, hint, error, required, disabled }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {rows > 0 ? (
        <textarea id={id} rows={rows} maxLength={max} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} className={`${inputClass} resize-y`} />
      ) : (
        <input id={id} type="text" maxLength={max} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} className={inputClass} />
      )}
      <div className="flex justify-between gap-3 mt-1">
        <span className={`text-xs ${error ? 'text-red-600' : 'text-gray-400'}`}>{error || hint || ''}</span>
        <span className="text-xs text-gray-400 flex-shrink-0">{value.length} / {max}</span>
      </div>
    </div>
  );
}

// A collapsible card
function Section({ title, count, open, onToggle, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 md:px-6 py-4 min-h-[48px] text-left hover:bg-gray-50"
      >
        <span className="text-base font-semibold text-gray-900">
          {title}
          {count !== undefined && <span className="ml-2 text-xs font-medium text-gray-400">{count}</span>}
        </span>
        <span className="text-gray-400 flex-shrink-0" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="px-4 md:px-6 pb-5 pt-1 space-y-4 border-t border-gray-100">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Short answers (Basics, Payments and policies, Facilities and languages, Always send to staff)
// ---------------------------------------------------------------------------
function FaqSection({ section, open, onToggle, faq, faqError, onRetry, onSaved }) {
  const { addToast } = useStore();
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  // The fields start from what is stored, and again after a successful save or a reload; a failed save leaves them alone
  useEffect(() => {
    if (!faq) return;
    const next = {};
    section.fields.forEach(f => { next[f.key] = faq[f.key] || ''; });
    setDrafts(next);
  }, [faq]);

  const save = async () => {
    const values = {};
    const nextErrors = {};
    section.fields.forEach(f => {
      values[f.key] = (drafts[f.key] || '').trim();
      if (f.required && !values[f.key]) nextErrors[f.key] = 'This is needed to save this section.';
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    try {
      const saved = await updateAiFaq(values);
      onSaved(saved);
      addToast('Saved', 'success');
    } catch (err) {
      addToast(getErrorMessage(err, 'Could not save. Try again.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={section.title} open={open} onToggle={onToggle}>
      {faqError ? (
        <LoadError message={faqError} onRetry={onRetry} />
      ) : !faq ? (
        <CardSkeleton />
      ) : (
        <>
          {section.fields.map(f => (
            <TextField
              key={f.key}
              id={`faq-${f.key}`}
              label={f.label}
              value={drafts[f.key] || ''}
              onChange={v => setDrafts(prev => ({ ...prev, [f.key]: v }))}
              max={f.max}
              rows={f.rows}
              required={f.required}
              error={errors[f.key]}
            />
          ))}
          {section.note && <p className="text-xs text-gray-500">{section.note}</p>}
          <div className="flex justify-end">
            <button type="button" onClick={save} disabled={saving} className={primaryButton}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Treatments
// ---------------------------------------------------------------------------
function TreatmentModal({ editing, onClose, onSaved }) {
  const { addToast } = useStore();
  const [form, setForm] = useState({
    name: editing?.name || '',
    price_text: editing?.price_text || '',
    details: editing?.details || ''
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const body = { name: form.name.trim(), price_text: form.price_text.trim(), details: form.details.trim() };
    if (!body.name) { setError('Enter a treatment name.'); return; }
    setError('');
    setSaving(true);
    try {
      const saved = editing ? await updateTreatment(editing.id, body) : await createTreatment(body);
      onSaved(saved, !editing);
      addToast('Saved', 'success');
    } catch (err) {
      // The form stays open with everything typed
      setError(getErrorMessage(err, 'Could not save. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={editing ? 'Edit treatment' : 'Add treatment'}>
      <div className="space-y-4">
        <TextField id="treatment-name" label="Treatment name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} max={120} required />
        <TextField id="treatment-price" label="Price" value={form.price_text} onChange={v => setForm(f => ({ ...f, price_text: v }))} max={60} hint="e.g. ₹1,500, ₹1,500–3,000, or After consultation" />
        <TextField id="treatment-details" label="Short detail" value={form.details} onChange={v => setForm(f => ({ ...f, details: v }))} max={300} rows={2} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={outlineButton}>Cancel</button>
          <button type="button" onClick={save} disabled={saving} className={primaryButton}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  );
}

function TreatmentsSection({ open, onToggle }) {
  const { addToast } = useStore();
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState(null); // null | { editing: row | null }
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoadError('');
    try {
      setRows(await getTreatments());
    } catch (err) {
      setLoadError(getErrorMessage(err, 'Could not load your treatments. Try again.'));
    }
  };
  useEffect(() => { load(); }, []);

  const remove = async (row) => {
    if (!window.confirm(`Delete "${row.name}"? This cannot be undone.`)) return;
    setBusyId(row.id);
    try {
      await deleteTreatment(row.id);
      setRows(prev => prev.filter(r => r.id !== row.id));
    } catch (err) {
      addToast(getErrorMessage(err, 'Could not delete. Try again.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const count = rows ? rows.length : 0;
  return (
    <Section title="Treatments and prices" count={rows ? `${count} of ${MAX_TREATMENTS}` : undefined} open={open} onToggle={onToggle}>
      {loadError ? (
        <LoadError message={loadError} onRetry={load} />
      ) : !rows ? (
        <CardSkeleton />
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="text-sm text-gray-500">No treatments added yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map(row => (
                <li key={row.id} className="py-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 break-words">{row.name}</p>
                    {row.price_text && <p className="text-sm text-gray-700 break-words">{row.price_text}</p>}
                    {row.details && <p className="text-xs text-gray-500 break-words">{row.details}</p>}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button type="button" onClick={() => setModal({ editing: row })} disabled={busyId === row.id} className={outlineButton}>Edit</button>
                    <button type="button" onClick={() => remove(row)} disabled={busyId === row.id} className={dangerButton}>Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div>
            <button type="button" onClick={() => setModal({ editing: null })} disabled={rows.length >= MAX_TREATMENTS} className={primaryButton}>Add treatment</button>
            {rows.length >= MAX_TREATMENTS && <p className="mt-2 text-xs text-gray-500">You have reached the limit of {MAX_TREATMENTS} treatments.</p>}
          </div>
        </>
      )}
      {modal && (
        <TreatmentModal
          editing={modal.editing}
          onClose={() => setModal(null)}
          onSaved={(saved, isNew) => {
            setRows(prev => (isNew ? [...(prev || []), saved] : (prev || []).map(r => (r.id === saved.id ? saved : r))));
            setModal(null);
          }}
        />
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------
function OfferModal({ editing, onClose, onSaved }) {
  const { addToast } = useStore();
  const [form, setForm] = useState({
    title: editing?.title || '',
    details: editing?.details || '',
    start_date: editing?.start_date || '',
    end_date: editing?.end_date || '',
    is_active: editing ? !!editing.is_active : true
  });
  const [qa, setQa] = useState(Array.isArray(editing?.qa) ? editing.qa.map(p => ({ q: p.q || '', a: p.a || '' })) : []);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const endBeforeStart = !!form.start_date && !!form.end_date && form.end_date < form.start_date;

  const setPair = (index, key, value) => setQa(prev => prev.map((p, i) => (i === index ? { ...p, [key]: value } : p)));

  const save = async () => {
    if (!form.title.trim()) { setError('Enter a title for the offer.'); return; }
    if (!form.start_date || !form.end_date) { setError('Choose a start date and an end date.'); return; }
    if (endBeforeStart) { setError('The end date must be on or after the start date.'); return; }
    // A pair needs both parts; pairs left completely empty are simply dropped
    const pairs = qa.map(p => ({ q: p.q.trim(), a: p.a.trim() })).filter(p => p.q || p.a);
    if (pairs.some(p => !p.q || !p.a)) { setError('Fill in both the question and the answer, or remove the pair.'); return; }
    setError('');
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        details: form.details.trim(),
        start_date: form.start_date,
        end_date: form.end_date,
        qa: pairs,
        is_active: form.is_active
      };
      const saved = editing ? await updateOffer(editing.id, body) : await createOffer(body);
      onSaved(saved, !editing);
      addToast('Saved', 'success');
    } catch (err) {
      // The form stays open with everything typed
      setError(getErrorMessage(err, 'Could not save. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={editing ? 'Edit offer' : 'Add offer'} size="lg">
      <div className="space-y-4">
        <TextField id="offer-title" label="Offer title" value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} max={120} required />
        <TextField id="offer-details" label="Details" value={form.details} onChange={v => setForm(f => ({ ...f, details: v }))} max={500} rows={3} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="offer-start" className="block text-sm font-medium text-gray-700 mb-1">Starts <span className="text-red-500">*</span></label>
            <input id="offer-start" type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label htmlFor="offer-end" className="block text-sm font-medium text-gray-700 mb-1">Ends <span className="text-red-500">*</span></label>
            <input id="offer-end" type="date" value={form.end_date} min={form.start_date || undefined} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} className={inputClass} />
          </div>
        </div>
        {endBeforeStart && <p role="alert" className="text-sm text-red-600">The end date must be on or after the start date.</p>}

        <div className="flex items-center justify-between gap-3">
          <span id="offer-active-label" className="text-sm font-medium text-gray-700">Offer is on</span>
          <button
            type="button"
            role="switch"
            aria-checked={form.is_active}
            aria-labelledby="offer-active-label"
            onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
            className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ${form.is_active ? 'bg-indigo-600' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${form.is_active ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-700">Questions and answers <span className="text-xs text-gray-400">({qa.length} of {MAX_QA})</span></p>
            <button type="button" onClick={() => setQa(prev => [...prev, { q: '', a: '' }])} disabled={qa.length >= MAX_QA} className={outlineButton}>Add question</button>
          </div>
          {qa.map((pair, index) => (
            <div key={index} className="border border-gray-200 rounded-lg p-3 space-y-3">
              <TextField id={`offer-q-${index}`} label="Question patients may ask" value={pair.q} onChange={v => setPair(index, 'q', v)} max={200} />
              <TextField id={`offer-a-${index}`} label="Answer" value={pair.a} onChange={v => setPair(index, 'a', v)} max={400} rows={2} />
              <button type="button" onClick={() => setQa(prev => prev.filter((_, i) => i !== index))} className={dangerButton}>Remove</button>
            </div>
          ))}
        </div>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={outlineButton}>Cancel</button>
          <button type="button" onClick={save} disabled={saving || endBeforeStart} className={primaryButton}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  );
}

// Running / Scheduled / Ended / Off. The server's is_running wins for "Running".
function offerBadge(offer) {
  const today = todayIST();
  if (!offer.is_active) return { label: 'Off', className: 'bg-gray-100 text-gray-600' };
  if (offer.is_running) return { label: 'Running', className: 'bg-green-100 text-green-800' };
  if (today < offer.start_date) return { label: 'Scheduled', className: 'bg-blue-100 text-blue-800' };
  if (today > offer.end_date) return { label: 'Ended', className: 'bg-gray-100 text-gray-600' };
  return { label: 'Running', className: 'bg-green-100 text-green-800' };
}

function OffersSection({ open, onToggle }) {
  const { addToast } = useStore();
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoadError('');
    try {
      setRows(await getOffers());
    } catch (err) {
      setLoadError(getErrorMessage(err, 'Could not load your offers. Try again.'));
    }
  };
  useEffect(() => { load(); }, []);

  const remove = async (row) => {
    if (!window.confirm(`Delete "${row.title}"? This cannot be undone.`)) return;
    setBusyId(row.id);
    try {
      await deleteOffer(row.id);
      setRows(prev => prev.filter(r => r.id !== row.id));
    } catch (err) {
      addToast(getErrorMessage(err, 'Could not delete. Try again.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Section title="Offers" count={rows ? `${rows.length} of ${MAX_OFFERS}` : undefined} open={open} onToggle={onToggle}>
      {loadError ? (
        <LoadError message={loadError} onRetry={load} />
      ) : !rows ? (
        <CardSkeleton />
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="text-sm text-gray-500">No offers yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map(row => {
                const badge = offerBadge(row);
                return (
                  <li key={row.id} className="py-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900 break-words">{row.title}</p>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badge.className}`}>{badge.label}</span>
                      </div>
                      <p className="text-xs text-gray-500">{formatDate(row.start_date)} – {formatDate(row.end_date)}</p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button type="button" onClick={() => setModal({ editing: row })} disabled={busyId === row.id} className={outlineButton}>Edit</button>
                      <button type="button" onClick={() => remove(row)} disabled={busyId === row.id} className={dangerButton}>Delete</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div>
            <button type="button" onClick={() => setModal({ editing: null })} disabled={rows.length >= MAX_OFFERS} className={primaryButton}>Add offer</button>
            {rows.length >= MAX_OFFERS && <p className="mt-2 text-xs text-gray-500">You have reached the limit of {MAX_OFFERS} offers.</p>}
          </div>
        </>
      )}
      {modal && (
        <OfferModal
          editing={modal.editing}
          onClose={() => setModal(null)}
          onSaved={(saved, isNew) => {
            setRows(prev => (isNew ? [saved, ...(prev || [])] : (prev || []).map(r => (r.id === saved.id ? saved : r))));
            setModal(null);
          }}
        />
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Questions the AI could not answer
// ---------------------------------------------------------------------------
function UnansweredSection({ open, onToggle }) {
  const { addToast } = useStore();
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoadError('');
    try {
      const all = await getUnansweredQuestions();
      // Only the open ones (the server also lists answered ones after them)
      setRows((Array.isArray(all) ? all : []).filter(q => !q.resolved_at));
    } catch (err) {
      setLoadError(getErrorMessage(err, 'Could not load the questions. Try again.'));
    }
  };
  useEffect(() => { load(); }, []);

  const resolve = async (row) => {
    setBusyId(row.id);
    try {
      await resolveUnansweredQuestion(row.id);
      setRows(prev => prev.filter(r => r.id !== row.id));
    } catch (err) {
      addToast(getErrorMessage(err, 'Could not update. Try again.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Section title="Questions the AI could not answer" count={rows ? String(rows.length) : undefined} open={open} onToggle={onToggle}>
      {loadError ? (
        <LoadError message={loadError} onRetry={load} />
      ) : !rows ? (
        <CardSkeleton />
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing here. Questions patients ask that the AI could not answer will appear here.</p>
      ) : (
        <>
          <ul className="divide-y divide-gray-100">
            {rows.map(row => (
              <li key={row.id} className="py-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-gray-900 break-words">{row.question}</p>
                  <p className="text-xs text-gray-400">{timeAgo(row.created_at)}</p>
                </div>
                <button type="button" onClick={() => resolve(row)} disabled={busyId === row.id} className={`${outlineButton} flex-shrink-0`}>
                  {busyId === row.id ? '...' : 'Mark as answered'}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500">Add the answer in the sections above, then mark the question as answered.</p>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Basics: the clinic's existing Business Phone (tenant_settings.business_phone, PUT /settings/hitl) and Clinic Address
// (tenant_configs clinic_address, PUT /settings/clinic), plus the map link (ai-faq). Each is saved on its own and only when it changed.
// ---------------------------------------------------------------------------
function BasicsSection({ open, onToggle, faq, faqError, onRetryFaq, onFaqSaved }) {
  const { addToast } = useStore();
  const [loading, setLoading] = useState(true);
  const [phoneLoadError, setPhoneLoadError] = useState('');
  const [addressLoadError, setAddressLoadError] = useState('');
  // saved: what is stored (null = not loaded yet); drafts: what is typed
  const [saved, setSaved] = useState({ phone: null, address: null, maps: null });
  const [drafts, setDrafts] = useState({ phone: '', address: '', maps: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  // A loaded value replaces the typed one only when nothing was typed over the old value (a retry never wipes typing)
  const adopt = (field, value) => {
    setDrafts(d => (saved[field] === null || d[field] === saved[field] ? { ...d, [field]: value } : d));
    setSaved(s => ({ ...s, [field]: value }));
  };

  const loadProfile = async () => {
    setLoading(true);
    const [hitl, clinic] = await Promise.allSettled([getHITLSettings(), getClinicSettings()]);
    if (hitl.status === 'fulfilled') {
      setPhoneLoadError('');
      adopt('phone', (hitl.value && hitl.value.business_phone) || '');
    } else {
      setPhoneLoadError(getErrorMessage(hitl.reason, 'Could not load the phone number. Try again.'));
    }
    if (clinic.status === 'fulfilled') {
      setAddressLoadError('');
      adopt('address', (clinic.value && clinic.value.address) || '');
    } else {
      setAddressLoadError(getErrorMessage(clinic.reason, 'Could not load the address. Try again.'));
    }
    setLoading(false);
  };
  useEffect(() => { loadProfile(); }, []);

  // The map link comes from the shared short-answers load
  useEffect(() => {
    if (!faq) return;
    adopt('maps', faq.maps_link || '');
  }, [faq]);

  const save = async () => {
    const phone = drafts.phone.trim();
    const address = drafts.address.trim();
    const maps = drafts.maps.trim();
    const nextErrors = {};
    if (saved.phone !== null && !phone) nextErrors.phone = 'This is needed to save this section.';
    setErrors(nextErrors);
    if (nextErrors.phone) return;

    const phoneChanged = saved.phone !== null && phone !== saved.phone.trim();
    const addressChanged = saved.address !== null && address !== saved.address.trim();
    const mapsChanged = saved.maps !== null && maps !== saved.maps.trim();
    if (!phoneChanged && !addressChanged && !mapsChanged) {
      addToast('No changes to save', 'info');
      return;
    }

    setSaving(true);
    let failed = false;
    if (phoneChanged) {
      try {
        const result = await updateHITLSettings({ business_phone: phone });
        const value = result && typeof result.business_phone === 'string' ? result.business_phone : phone;
        setSaved(s => ({ ...s, phone: value }));
        setDrafts(d => ({ ...d, phone: value }));
      } catch (err) {
        failed = true;
        addToast(getErrorMessage(err, 'Could not save the phone number. Try again.'), 'error');
      }
    }
    if (addressChanged) {
      try {
        const result = await updateClinicSettings({ address });
        const value = result && typeof result.address === 'string' ? result.address : address;
        setSaved(s => ({ ...s, address: value }));
        setDrafts(d => ({ ...d, address: value }));
      } catch (err) {
        failed = true;
        addToast(getErrorMessage(err, 'Could not save the address. Try again.'), 'error');
      }
    }
    if (mapsChanged) {
      try {
        const result = await updateAiFaq({ maps_link: maps });
        onFaqSaved(result);
      } catch (err) {
        failed = true;
        addToast(getErrorMessage(err, 'Could not save the map link. Try again.'), 'error');
      }
    }
    setSaving(false);
    if (!failed) addToast('Saved', 'success');
  };

  return (
    <Section title="Basics" open={open} onToggle={onToggle}>
      {loading && saved.phone === null && saved.address === null && !faq && !faqError ? (
        <CardSkeleton />
      ) : (
        <>
          {phoneLoadError && <LoadError message={phoneLoadError} onRetry={loadProfile} />}
          {addressLoadError && <LoadError message={addressLoadError} onRetry={loadProfile} />}
          {faqError && <LoadError message={faqError} onRetry={onRetryFaq} />}
          <TextField
            id="basics-phone"
            label="Phone patients should call"
            value={drafts.phone}
            onChange={v => setDrafts(d => ({ ...d, phone: v }))}
            max={20}
            required
            disabled={saved.phone === null}
            error={errors.phone}
          />
          <TextField
            id="basics-address"
            label="Address"
            value={drafts.address}
            onChange={v => setDrafts(d => ({ ...d, address: v }))}
            max={300}
            rows={2}
            disabled={saved.address === null}
          />
          <TextField
            id="basics-maps"
            label="Map link"
            value={drafts.maps}
            onChange={v => setDrafts(d => ({ ...d, maps: v }))}
            max={300}
            disabled={saved.maps === null}
          />
          <p className="text-xs text-gray-500">Doctor consultation fees are taken from each doctor's profile on the Doctors page.</p>
          <p className="text-xs text-gray-500">The phone and address are the same details shown in Settings, Clinic Profile.</p>
          <div className="flex justify-end">
            <button type="button" onClick={save} disabled={saving} className={primaryButton}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------
export default function ClinicAnswers({ plan }) {
  const unlocked = plan === 'growth' || plan === 'pro';
  const [openSections, setOpenSections] = useState({ basics: true });
  const toggle = (id) => setOpenSections(prev => ({ ...prev, [id]: !prev[id] }));

  const [faq, setFaq] = useState(null);
  const [faqError, setFaqError] = useState('');
  const loadFaq = async () => {
    setFaqError('');
    try {
      setFaq(await getAiFaq());
    } catch (err) {
      setFaqError(getErrorMessage(err, 'Could not load your answers. Try again.'));
    }
  };
  useEffect(() => {
    if (unlocked) loadFaq();
  }, [unlocked]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Answers you save here help the AI reply to patients. They start being used once ReceptionAI turns this on for your clinic.
      </p>

      {!unlocked ? (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-gray-50 border border-gray-200">
          <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <p className="text-sm text-gray-500">
            Available on <span className="font-semibold text-gray-700">Growth and Pro plans</span>.
            {' '}Upgrade to let the AI answer from your clinic's own details.
          </p>
        </div>
      ) : (
        <>
          <BasicsSection
            open={!!openSections.basics}
            onToggle={() => toggle('basics')}
            faq={faq}
            faqError={faqError}
            onRetryFaq={loadFaq}
            onFaqSaved={setFaq}
          />
          {FAQ_SECTIONS.map(section => (
            <FaqSection
              key={section.id}
              section={section}
              open={!!openSections[section.id]}
              onToggle={() => toggle(section.id)}
              faq={faq}
              faqError={faqError}
              onRetry={loadFaq}
              onSaved={setFaq}
            />
          ))}
          <TreatmentsSection open={!!openSections.treatments} onToggle={() => toggle('treatments')} />
          <OffersSection open={!!openSections.offers} onToggle={() => toggle('offers')} />
          <UnansweredSection open={!!openSections.unanswered} onToggle={() => toggle('unanswered')} />
        </>
      )}
    </div>
  );
}

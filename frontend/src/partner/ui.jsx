// Small UI pieces shared by the partner portal and the promoter admin screens.
import React from 'react';

export const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-500';
export const btnPrimary = 'px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50';
export const btnSecondary = 'px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50';
export const btnDanger = 'px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50';

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`bg-white shadow-sm rounded-lg border border-gray-200 p-5 ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          {title && <h2 className="text-base font-semibold text-gray-900">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = 'default' }) {
  const tones = { default: 'text-gray-900', green: 'text-green-700', amber: 'text-amber-700', red: 'text-red-700', indigo: 'text-indigo-700' };
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

const BADGE = {
  active: 'bg-green-100 text-green-800',
  available: 'bg-green-100 text-green-800',
  paid: 'bg-indigo-100 text-indigo-800',
  verified: 'bg-green-100 text-green-800',
  approved: 'bg-blue-100 text-blue-800',
  pending: 'bg-yellow-100 text-yellow-800',
  draft: 'bg-gray-100 text-gray-800',
  submitted: 'bg-yellow-100 text-yellow-800',
  under_review: 'bg-yellow-100 text-yellow-800',
  flagged: 'bg-orange-100 text-orange-800',
  suspended: 'bg-red-100 text-red-800',
  terminated: 'bg-red-100 text-red-800',
  rejected: 'bg-red-100 text-red-800',
  revoked: 'bg-red-100 text-red-800',
  void: 'bg-gray-100 text-gray-500 line-through',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-500',
  closed: 'bg-gray-100 text-gray-500',
  captured: 'bg-green-100 text-green-800',
  partially_refunded: 'bg-amber-100 text-amber-800',
  refunded: 'bg-red-100 text-red-800',
  voided: 'bg-gray-100 text-gray-500',
  not_submitted: 'bg-gray-100 text-gray-700'
};

const LABELS = {
  pending: 'On hold', available: 'Available', under_review: 'Under review', not_submitted: 'Not submitted',
  partially_refunded: 'Partly refunded'
};

export function Badge({ status, label }) {
  const text = label || LABELS[status] || String(status || '—').replace(/_/g, ' ');
  return (
    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full capitalize ${BADGE[status] || 'bg-gray-100 text-gray-800'}`}>
      {text}
    </span>
  );
}

export function Field({ label, error, hint, children, required }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1">{label}{required && <span className="text-red-500"> *</span>}</span>
      {children}
      {hint && !error && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
      {error && <span className="block text-xs text-red-600 mt-1">{error}</span>}
    </label>
  );
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
}

export function Empty({ children }) {
  return <p className="text-sm text-gray-500 py-6 text-center">{children}</p>;
}

export function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-xl shadow-xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none" aria-label="Close">×</button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

/** Very small Markdown renderer for the agreement text: headings, paragraphs, bullet lists. No HTML. */
export function SimpleMarkdown({ text }) {
  const blocks = String(text || '').split(/\n{2,}/);
  return (
    <div className="space-y-3 text-sm text-gray-700">
      {blocks.map((b, i) => {
        const t = b.trim();
        if (t.startsWith('### ')) return <h4 key={i} className="font-semibold text-gray-900">{t.slice(4)}</h4>;
        if (t.startsWith('## ')) return <h3 key={i} className="text-base font-semibold text-gray-900">{t.slice(3)}</h3>;
        if (t.startsWith('# ')) return <h2 key={i} className="text-lg font-bold text-gray-900">{t.slice(2)}</h2>;
        const lines = t.split('\n');
        if (lines.every(l => /^\s*[-*] /.test(l))) {
          return <ul key={i} className="list-disc pl-5 space-y-1">{lines.map((l, j) => <li key={j}>{l.replace(/^\s*[-*] /, '')}</li>)}</ul>;
        }
        return <p key={i} className="whitespace-pre-line">{t}</p>;
      })}
    </div>
  );
}

/** Pulls a readable message out of an API error ({ error, details }) */
export function apiError(err, fallback = 'Something went wrong') {
  return err?.error || err?.message || fallback;
}

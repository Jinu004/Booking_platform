import React, { useState, useEffect } from 'react';
import api from '../../utils/api';

const RANGES = [
  { key: '24h', label: 'Last 24 hours' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' }
];

const CTX_WORDS = {
  text: 'text',
  template: 'template',
  document: 'document',
  buttons: 'buttons',
  list: 'list',
  contact: 'contact',
  media_upload: 'media upload'
};

function reasonClasses(code) {
  if (code === 131042 || code === 132001) return 'bg-red-100 text-red-700';
  if (code === 131047 || code === 131026) return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-600';
}

/**
 * Failed WhatsApp sends of one clinic, read from our own database (the routes never call Meta).
 * Super admin only (the routes are). Props: tenantId
 */
export default function SendFailuresPanel({ tenantId }) {
  const [range, setRange] = useState('7d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.get(`/superadmin/tenants/${tenantId}/send-failures?range=${range}`)
      .then(res => {
        if (!cancelled) setData(res?.data || null);
      })
      .catch(err => {
        if (!cancelled) setError(err?.error || 'Failed to load the failed sends');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tenantId, range, reloadKey]);

  const total = data?.summary?.total ?? 0;
  const byCode = data?.summary?.by_code || [];
  const rows = data?.rows || [];

  return (
    <div className="border-t pt-3 space-y-3">
      <h5 className="text-sm font-semibold text-gray-700">Failed sends</h5>

      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map(r => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              range === r.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {r.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setReloadKey(k => k + 1)}
          disabled={loading}
          className="px-3 py-1.5 border border-indigo-600 text-indigo-600 rounded-lg text-sm font-medium hover:bg-indigo-50 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && <p className="text-red-600 text-xs">{error}</p>}

      {!error && data && total === 0 && (
        <p className="text-xs text-green-600">No failed sends in this period</p>
      )}

      {!error && data && total > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-700 font-medium">{total} failed sends</p>
          <div className="flex flex-wrap gap-2">
            {byCode.map(item => (
              <span
                key={String(item.code)}
                className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${reasonClasses(item.code)}`}
              >
                {item.label} ({item.count})
              </span>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1 pr-2 font-medium">Time</th>
                  <th className="py-1 pr-2 font-medium">Sending</th>
                  <th className="py-1 pr-2 font-medium">Template</th>
                  <th className="py-1 pr-2 font-medium">Reason</th>
                  <th className="py-1 font-medium">Meta code</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.created_at}-${index}`} className="border-t border-gray-100 align-top">
                    <td className="py-1 pr-2 text-gray-600 whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
                    <td className="py-1 pr-2 text-gray-700">{CTX_WORDS[row.ctx] || row.ctx || '—'}</td>
                    <td className="py-1 pr-2 text-gray-700">{row.template_name || '—'}</td>
                    <td className="py-1 pr-2">
                      <span
                        title={`Subcode: ${row.meta_subcode ?? '—'}, HTTP status: ${row.http_status ?? '—'}`}
                        className={`inline-block px-2 py-0.5 rounded-full font-medium ${reasonClasses(row.meta_code)}`}
                      >
                        {row.label}
                      </span>
                      {row.error_message && <div className="text-gray-400 mt-0.5">{row.error_message}</div>}
                    </td>
                    <td className="py-1 text-gray-600">{row.meta_code ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length >= 50 && <p className="text-xs text-gray-500">Showing the latest 50</p>}
        </div>
      )}

      {loading && !data && !error && (
        <p className="text-xs text-gray-500">Loading...</p>
      )}
    </div>
  );
}

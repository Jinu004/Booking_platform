import React, { useState, useEffect } from 'react';
import api from '../../utils/api';

const EXPECTED_TEMPLATES = 7;

function statusClasses(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'APPROVED') return 'bg-green-100 text-green-700';
  if (s === 'PENDING' || s === 'IN_REVIEW') return 'bg-amber-100 text-amber-700';
  if (s === 'REJECTED' || s === 'ERROR' || s === 'NOT_FOUND') return 'bg-red-100 text-red-700';
  return 'bg-gray-100 text-gray-600';
}

/**
 * The message templates of a clinic's own WhatsApp account: stored status, create the missing ones, refresh from Meta.
 * Super admin only (the routes are). Props: tenantId
 */
export default function WhatsappTemplatesPanel({ tenantId }) {
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(''); // '' | 'load' | 'create' | 'refresh'
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadRows = async () => {
    const res = await api.get(`/superadmin/tenants/${tenantId}/templates`);
    setRows(Array.isArray(res?.data) ? res.data : []);
    setLoaded(true);
  };

  useEffect(() => {
    let cancelled = false;
    setRows([]);
    setLoaded(false);
    setMessage('');
    setError('');
    setBusy('load');
    api.get(`/superadmin/tenants/${tenantId}/templates`)
      .then(res => {
        if (cancelled) return;
        setRows(Array.isArray(res?.data) ? res.data : []);
        setLoaded(true);
      })
      .catch(err => {
        if (!cancelled) setError(err?.error || 'Failed to load the templates');
      })
      .finally(() => {
        if (!cancelled) setBusy('');
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  const createTemplates = async () => {
    const confirmed = window.confirm(
      "Create the 7 message templates on this clinic's WhatsApp account? Meta reviews each one, which can take up to 24 hours."
    );
    if (!confirmed) return;
    setBusy('create');
    setMessage('');
    setError('');
    try {
      const res = await api.post(`/superadmin/tenants/${tenantId}/templates/create`);
      const summary = Array.isArray(res?.data) ? res.data : [];
      const failures = summary.filter(item => item.error);
      const existing = summary.filter(item => !item.error && item.existing === true).length;
      const created = summary.filter(item => !item.error && item.existing !== true).length;
      setMessage(`Created ${created}, already on the account ${existing}, failed ${failures.length}.`);
      if (failures.length) {
        setError(failures.map(item => `${item.name}: ${item.error}`).join(' | '));
      }
      await loadRows();
    } catch (err) {
      setError(err?.error || 'Failed to create the templates');
    } finally {
      setBusy('');
    }
  };

  const refreshStatuses = async () => {
    setBusy('refresh');
    setMessage('');
    setError('');
    try {
      await api.post(`/superadmin/tenants/${tenantId}/templates/refresh`);
      await loadRows();
      setMessage('Statuses refreshed from Meta.');
    } catch (err) {
      setError(err?.error || 'Failed to refresh the template statuses');
    } finally {
      setBusy('');
    }
  };

  // The count covers the 7 standard templates only; the clinic's poster template (clinic_poster) is shown next to it, not in it
  const posterRow = rows.find(row => row.name === 'clinic_poster');
  const approved = rows.filter(row => row.name !== 'clinic_poster' && String(row.status).toUpperCase() === 'APPROVED').length;
  const disabled = busy !== '';

  return (
    <div className="border-t pt-3 space-y-2">
      <h5 className="text-sm font-semibold text-gray-700">WhatsApp templates</h5>

      {loaded && rows.length === 0 && (
        <p className="text-xs text-gray-500">No templates created yet</p>
      )}

      {rows.length > 0 && (
        <>
          <p className="text-xs text-gray-600">
            {approved} of {EXPECTED_TEMPLATES} approved
            {posterRow && <span className="text-gray-400"> · poster template: {String(posterRow.status).toLowerCase()}</span>}
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1 pr-2 font-medium">Template</th>
                <th className="py-1 pr-2 font-medium">Category</th>
                <th className="py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id || `${row.name}-${row.language}`} className="border-t border-gray-100 align-top">
                  <td className="py-1 pr-2 text-gray-700">
                    {row.name}
                    {row.last_error && <div className="text-gray-400">{row.last_error}</div>}
                  </td>
                  <td className="py-1 pr-2 text-gray-600">{row.category}</td>
                  <td className="py-1">
                    <span
                      title={row.last_error || ''}
                      className={`inline-block px-2 py-0.5 rounded-full font-medium ${statusClasses(row.status)}`}
                    >
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {approved < EXPECTED_TEMPLATES && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
              Do not go live until all {EXPECTED_TEMPLATES} templates are approved. Missing templates make reminders and recall fail silently.
            </p>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={createTemplates}
          disabled={disabled}
          className="px-4 py-2 border border-indigo-600 text-indigo-600 rounded-lg text-sm font-medium hover:bg-indigo-50 disabled:opacity-50"
        >
          {busy === 'create' ? 'Creating...' : 'Create templates'}
        </button>
        <button
          type="button"
          onClick={refreshStatuses}
          disabled={disabled}
          className="px-4 py-2 border border-indigo-600 text-indigo-600 rounded-lg text-sm font-medium hover:bg-indigo-50 disabled:opacity-50"
        >
          {busy === 'refresh' ? 'Refreshing...' : busy === 'load' ? 'Loading...' : 'Refresh status'}
        </button>
      </div>

      {message && <p className="text-green-600 text-xs">{message}</p>}
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </div>
  );
}

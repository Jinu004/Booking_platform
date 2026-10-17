import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getAllTenants, updateTenant } from '../../services/superadmin.service';
import useStore from '../../store/useStore';
import api from '../../utils/api';
import CoexistenceConnect from '../../components/shared/CoexistenceConnect';
import WhatsappTemplatesPanel from '../../components/shared/WhatsappTemplatesPanel';
import SendFailuresPanel from '../../components/shared/SendFailuresPanel';

const PLANS = ['starter', 'growth', 'pro'];

const statusBadge = (status) => {
  const map = {
    active: 'bg-green-100 text-green-800',
    suspended: 'bg-red-100 text-red-800',
    pending: 'bg-yellow-100 text-yellow-800',
  };
  return (
    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${map[status] || 'bg-gray-100 text-gray-800'}`}>
      {status}
    </span>
  );
};

const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

// The form values for a tenant row of the list (same fields and defaults the Edit popup used)
const formFromTenant = (t) => ({
  clinicName: t.name,
  plan: t.plan,
  whatsappNumber: t.whatsapp_number || '',
  whatsappPhoneNumberId: t.whatsapp_phone_number_id || '',
  industry: t.industry || 'clinic',
  aiModel: t.ai_model || '',
  proactiveTemplates: t.proactive_templates_enabled === 'true',
  recallEnabled: t.recall_enabled !== 'false',
  email: t.email || ''
});

// One card of the page; the children keep their own spacing
function Card({ title, children, flush = false }) {
  return (
    <section className="bg-white shadow rounded-lg border border-gray-200 p-6">
      {title && <h2 className="text-base font-semibold text-gray-900 mb-4">{title}</h2>}
      {/* flush: the child component brings its own top border and heading spacing, which a card does not need */}
      <div className={flush ? '[&>div:first-child]:border-t-0 [&>div:first-child]:pt-0 [&>div:first-child]:mt-0' : ''}>
        {children}
      </div>
    </section>
  );
}

export default function TenantEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToast } = useStore();

  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [justConnected, setJustConnected] = useState(false);

  // The backend has no list-free way to get everything this page needs (recall and template flags, admin email,
  // connection flags), so the tenants list is loaded and this tenant is picked from it by id.
  const fetchTenantRow = async () => {
    const res = await getAllTenants();
    const rows = Array.isArray(res?.data) ? res.data : [];
    return rows.find(t => t.id === id) || null;
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setTenant(null);
    setForm(null);
    setJustConnected(false);
    fetchTenantRow()
      .then(row => {
        if (cancelled) return;
        if (!row) {
          setLoadError('Tenant not found');
          return;
        }
        setTenant(row);
        setForm(formFromTenant(row));
      })
      .catch(err => {
        if (!cancelled) setLoadError(err?.error || 'Failed to load the tenant');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  const goToList = () => navigate('/superadmin');

  const handleSave = async () => {
    setError('');
    if (form.industry !== tenant.industry) {
      const confirmed = window.confirm(
        `Changing industry from "${tenant.industry}" to "${form.industry}" will change the AI behaviour, pages, and theme for this tenant immediately. Are you sure?`
      );
      if (!confirmed) return;
    }
    try {
      setSaving(true);
      const { proactiveTemplates, ...tenantForm } = form;
      await updateTenant(tenant.id, tenantForm);
      await api.patch(`/superadmin/tenants/${tenant.id}/config`, {
        key: 'proactive_templates_enabled',
        value: String(proactiveTemplates)
      });
      await api.patch(`/superadmin/tenants/${tenant.id}/config`, { key: 'recall_enabled', value: String(form.recallEnabled) });
      addToast('Clinic updated', 'success');
      goToList();
    } catch (err) {
      setError(err?.error || err?.response?.data?.error || 'Failed to update clinic');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClinic = async () => {
    const confirmed = window.prompt(`Type "${tenant.name}" to confirm permanent deletion:`);
    if (confirmed !== tenant.name) {
      if (confirmed !== null) addToast('Clinic name did not match', 'error');
      return;
    }
    try {
      await api.delete(`/superadmin/tenants/${tenant.id}`);
      addToast('Clinic deleted permanently', 'success');
      goToList();
    } catch {
      addToast('Failed to delete clinic', 'error');
    }
  };

  if (loading) {
    return (
      <div className="p-0 md:p-8">
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    );
  }

  if (loadError || !tenant || !form) {
    return (
      <div className="p-0 md:p-8 space-y-4">
        <Link to="/superadmin" className="text-sm text-indigo-600 hover:text-indigo-900">← Tenants</Link>
        <p className="text-sm text-red-600">{loadError || 'Tenant not found'}</p>
      </div>
    );
  }

  // A connection that is already saved, or one made on this page a moment ago
  const connectionSaved = (!!tenant.whatsapp_connected_at && tenant.whatsapp_token_set === true) || justConnected;

  return (
    <div className="p-0 md:p-8 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="space-y-3">
        <Link to="/superadmin" className="text-sm text-indigo-600 hover:text-indigo-900">← Tenants</Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{tenant.name}</h1>
            {statusBadge(tenant.status)}
          </div>
          <div className="flex gap-3">
            <button
              onClick={goToList}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}
      </div>

      {/* Clinic details */}
      <Card title="Clinic details">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Clinic Name</label>
            <input
              type="text"
              value={form.clinicName}
              onChange={e => setForm(f => ({ ...f, clinicName: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Admin Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className={inputClass}
              placeholder="clinic@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Plan</label>
            <select
              value={form.plan}
              onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
              className={inputClass}
            >
              {PLANS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
            <select
              value={form.industry}
              onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}
              className={inputClass}
            >
              <option value="clinic">Clinic</option>
              <option value="enquiry">Enquiry</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Number</label>
            <input
              type="text"
              value={form.whatsappNumber}
              onChange={e => setForm(f => ({ ...f, whatsappNumber: e.target.value }))}
              className={inputClass}
              placeholder="+919876543210"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number ID</label>
            <input
              type="text"
              value={form.whatsappPhoneNumberId}
              onChange={e => setForm(f => ({ ...f, whatsappPhoneNumberId: e.target.value.replace(/\D/g, '') }))}
              className={inputClass}
              placeholder="Digits only"
            />
            <p className="text-xs text-gray-400 mt-1">From WhatsApp Manager (gear icon next to the number). Used to send reminders and staff replies from this clinic's number.</p>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">AI Model Override <span className="text-gray-400 font-normal">(optional — overrides plan default)</span></label>
            <select
              value={form.aiModel}
              onChange={e => setForm(f => ({ ...f, aiModel: e.target.value }))}
              className={inputClass}
            >
              <option value="">Use plan default</option>
              <option value="gemini-2.5-pro">gemini-2.5-pro (Pro quality)</option>
              <option value="gemini-2.5-flash">gemini-2.5-flash (Balanced)</option>
              <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite (Fast)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Proactive Template Messaging</label>
            <div className="flex items-center gap-3 mt-1">
              <input
                type="checkbox"
                id="proactiveTemplates"
                checked={form.proactiveTemplates}
                onChange={e => setForm(f => ({ ...f, proactiveTemplates: e.target.checked }))}
                className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
              />
              <label htmlFor="proactiveTemplates" className="text-sm text-gray-600">
                Allow staff to send template messages when 24-hour window is closed
              </label>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Recall Checkup Messages</label>
            <div className="flex items-center gap-3 mt-1">
              <input
                type="checkbox"
                id="recallEnabled"
                checked={form.recallEnabled}
                onChange={e => setForm(f => ({ ...f, recallEnabled: e.target.checked }))}
                className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
              />
              <label htmlFor="recallEnabled" className="text-sm text-gray-600">
                Send recall checkup WhatsApp reminders to patients not seen in 90 days (every Monday)
              </label>
            </div>
          </div>
        </div>

        {tenant.status === 'suspended' && (
          <div className="mt-6 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={handleDeleteClinic}
              className="px-4 py-2 text-red-600 border border-red-200 rounded-md hover:bg-red-50 text-sm font-medium"
            >
              Delete Permanently
            </button>
          </div>
        )}
      </Card>

      {/* WhatsApp connection (Coexistence) */}
      <Card flush>
        <CoexistenceConnect
          key={tenant.id}
          tenant={tenant}
          addToast={addToast}
          onConnected={(connected) => {
            setJustConnected(true);
            setForm(f => ({ ...f, whatsappPhoneNumberId: connected.phoneNumberId || f.whatsappPhoneNumberId }));
          }}
        />
      </Card>

      {/* WhatsApp templates: only for a connection that is saved */}
      {connectionSaved && (
        <Card flush>
          <WhatsappTemplatesPanel tenantId={tenant.id} />
        </Card>
      )}

      {/* Failed WhatsApp sends of this clinic (from our own database) */}
      <Card flush>
        <SendFailuresPanel tenantId={tenant.id} />
      </Card>
    </div>
  );
}

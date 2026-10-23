import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllTenants, getPlatformStats, updateTenantStatus, createTenant, clearTenantConversations } from '../services/superadmin.service';
import useStore from '../store/useStore';
import api from '../utils/api';
import { StatCardSkeleton, TableRowSkeleton } from '../components/shared/Skeleton';
import PosterImage from '../components/shared/PosterImage';
import { usePlanIds } from '../hooks/usePlans';


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

const industryBadge = (industry) => {
  const map = {
    clinic: { className: 'bg-blue-100 text-blue-800', label: 'Clinic' },
    enquiry: { className: 'bg-amber-100 text-amber-800', label: 'Enquiry' },
  };
  const fallbackLabel = industry
    ? industry.charAt(0).toUpperCase() + industry.slice(1)
    : '—';
  const { className, label } = map[industry] || { className: 'bg-gray-100 text-gray-800', label: fallbackLabel };
  return (
    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${className}`}>
      {label}
    </span>
  );
};

export default function SuperAdmin() {
  const PLANS = usePlanIds();
  const { staff, addToast } = useStore();
  const navigate = useNavigate();


  const [stats, setStats] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [failureCounts, setFailureCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [industryFilter, setIndustryFilter] = useState('all');
  const [view, setView] = useState('tenants');

  // Poster requests state
  const [posterRequests, setPosterRequests] = useState([]);
  const [posterLoading, setPosterLoading] = useState(false);
  const [posterStatusFilter, setPosterStatusFilter] = useState('pending');
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectNotes, setRejectNotes] = useState('');

  const fetchPosterRequests = async () => {
    try {
      setPosterLoading(true);
      const params = posterStatusFilter !== 'all' ? `?status=${posterStatusFilter}` : '';
      const res = await api.get(`/superadmin/poster-requests${params}`);
      setPosterRequests(res.data || []);
    } catch {
      addToast('Failed to load poster requests', 'error');
    } finally {
      setPosterLoading(false);
    }
  };

  // One approve or reject request at a time: the buttons are disabled while it runs and a second click is ignored
  const [posterBusyId, setPosterBusyId] = useState(null);
  const posterBusyRef = useRef(null);

  // The list response has the stored file name (image_url) but no content type: a .webp name is the only way to tell
  const isWebpPoster = (pr) => /\.webp(\?|$)/i.test(String(pr?.image_url || ''));

  const handleApprovePoster = async (id) => {
    if (posterBusyRef.current) return;
    posterBusyRef.current = id;
    setPosterBusyId(id);
    try {
      await api.patch(`/superadmin/poster-requests/${id}/approve`);
      addToast('Poster approved', 'success');
      fetchPosterRequests();
    } catch {
      addToast('Failed to approve poster', 'error');
    } finally {
      posterBusyRef.current = null;
      setPosterBusyId(null);
    }
  };

  const handleRejectPoster = async (id) => {
    if (posterBusyRef.current) return;
    posterBusyRef.current = id;
    setPosterBusyId(id);
    try {
      await api.patch(`/superadmin/poster-requests/${id}/reject`, { notes: rejectNotes || null });
      addToast('Poster rejected', 'success');
      setRejectingId(null);
      setRejectNotes('');
      fetchPosterRequests();
    } catch {
      addToast('Failed to reject poster', 'error');
    } finally {
      posterBusyRef.current = null;
      setPosterBusyId(null);
    }
  };

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ clinicName: '', email: '', password: '', plan: 'starter', industry: 'clinic' });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  const ownTenantId = staff?.tenantId;

  useEffect(() => { fetchData(); }, []);
  useEffect(() => { if (view === 'posters') fetchPosterRequests(); }, [view, posterStatusFilter]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [statsRes, tenantsRes] = await Promise.all([
        getPlatformStats().catch(() => ({ data: {} })),
        getAllTenants().catch(() => ({ data: [] }))
      ]);
      setStats(statsRes.data || {});
      setTenants(Array.isArray(tenantsRes.data) ? tenantsRes.data : []);
      // Failed sends of the last 24 hours per tenant; if this fails the list simply shows no badges
      api.get('/superadmin/send-failures/summary')
        .then(res => {
          const counts = {};
          (Array.isArray(res?.data) ? res.data : []).forEach(item => { counts[item.tenant_id] = item.count; });
          setFailureCounts(counts);
        })
        .catch(() => setFailureCounts({}));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (id, currentStatus) => {
    let newStatus;
    let confirmMsg;
    if (currentStatus === 'pending') {
      newStatus = 'active';
      confirmMsg = 'Approve this clinic and activate their account?';
    } else if (currentStatus === 'active') {
      newStatus = 'suspended';
      confirmMsg = 'Suspend this clinic?';
    } else {
      newStatus = 'active';
      confirmMsg = 'Reactivate this clinic?';
    }
    if (!window.confirm(confirmMsg)) return;
    try {
      await updateTenantStatus(id, newStatus);
      fetchData();
    } catch {
      alert('Failed to update status');
    }
  };

  const handleCreate = async () => {
    setCreateError('');
    if (!createForm.clinicName || !createForm.email || !createForm.password) {
      setCreateError('All fields are required');
      return;
    }
    try {
      setCreateLoading(true);
      await createTenant(createForm);
      setShowCreate(false);
      setCreateForm({ clinicName: '', email: '', password: '', plan: 'starter', industry: 'clinic' });
      fetchData();
    } catch (err) {
      setCreateError(err?.error || err?.response?.data?.error || 'Failed to create clinic');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleClearConversations = async (t) => {
    if (!window.confirm(`Clear all old conversations for ${t.name}? This cannot be undone.`)) return
    try {
      const res = await clearTenantConversations(t.id)
      alert(res.data.message)
      fetchData()
    } catch {
      alert('Failed to clear conversations')
    }
  }
  if (loading) {
    return (
      <div className="p-0 md:p-8 space-y-8">
        <h1 className="text-2xl font-bold text-gray-900">Platform Admin</h1>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
        </div>
        <div className="bg-white shadow rounded-lg border border-gray-200">
          <TableRowSkeleton rows={5} />
        </div>
      </div>
    );
  }

  const clinicCount = tenants.filter(t => t.industry === 'clinic').length;
  const enquiryCount = tenants.filter(t => t.industry === 'enquiry').length;
  const industryTabs = [
    { key: 'all', label: 'All', count: tenants.length },
    { key: 'clinic', label: 'Clinic', count: clinicCount },
    { key: 'enquiry', label: 'Enquiry', count: enquiryCount },
  ];
  const filteredTenants = industryFilter === 'all'
    ? tenants
    : tenants.filter(t => t.industry === industryFilter);

  return (
    <div className="p-0 md:p-8 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Platform Admin</h1>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {[{ key: 'tenants', label: 'Tenants' }, { key: 'posters', label: 'Posters' }].map(v => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  view === v.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          {view === 'tenants' && (
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap"
            >
              + New Tenant
            </button>
          )}
        </div>
      </div>

      {/* Posters View */}
      {view === 'posters' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {['all', 'pending', 'approved', 'rejected'].map(s => (
              <button
                key={s}
                onClick={() => setPosterStatusFilter(s)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  posterStatusFilter === s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Image</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tenant</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Caption</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Submitted</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {posterLoading ? (
                    <tr><td colSpan="6" className="px-6 py-8 text-center text-sm text-gray-400">Loading...</td></tr>
                  ) : posterRequests.length === 0 ? (
                    <tr><td colSpan="6" className="px-6 py-8 text-center text-sm text-gray-500">No poster requests</td></tr>
                  ) : posterRequests.map(pr => (
                    <tr key={pr.id}>
                      <td className="px-4 py-3">
                        <PosterImage path={`/superadmin/poster-requests/${pr.id}/image`} className="w-14 h-14 object-cover rounded-lg border border-gray-200" />
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{pr.tenant_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        <div className="max-w-xs whitespace-pre-wrap break-words">{pr.caption || <span className="text-gray-300">—</span>}</div>
                      </td>
                      <td className="px-4 py-3">{statusBadge(pr.status)}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{new Date(pr.created_at).toLocaleDateString('en-IN')}</td>
                      <td className="px-4 py-3 text-right text-sm font-medium">
                        {pr.status === 'pending' && (
                          <div className="flex items-center justify-end gap-2">
                            {isWebpPoster(pr) && <span className="text-xs text-amber-600">WebP: cannot be used for campaigns</span>}
                            <button onClick={() => handleApprovePoster(pr.id)} disabled={posterBusyId !== null} className="text-green-600 hover:text-green-900 disabled:opacity-50">{posterBusyId === pr.id ? 'Working...' : 'Approve'}</button>
                            <button onClick={() => { setRejectingId(pr.id); setRejectNotes(''); }} disabled={posterBusyId !== null} className="text-red-600 hover:text-red-900 disabled:opacity-50">Reject</button>
                          </div>
                        )}
                        {pr.status === 'rejected' && pr.notes && (
                          <span className="text-xs text-red-500">{pr.notes}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {rejectingId && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
                <h2 className="text-lg font-semibold text-gray-900">Reject Poster Request</h2>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reason (optional)</label>
                  <textarea
                    rows={3}
                    value={rejectNotes}
                    onChange={e => setRejectNotes(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                    placeholder="e.g. Image quality too low, please re-upload"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={() => { setRejectingId(null); setRejectNotes(''); }} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
                  <button onClick={() => handleRejectPoster(rejectingId)} disabled={posterBusyId !== null} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">{posterBusyId === rejectingId ? 'Rejecting...' : 'Reject'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'tenants' && <>
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: 'Total Tenants', value: stats?.total_tenants || 0, color: 'text-gray-900' },
          { label: 'Active Tenants', value: stats?.active_tenants || 0, color: 'text-green-600' },
          { label: 'Bookings Today', value: stats?.total_bookings_today || 0, color: 'text-gray-900' },
          { label: 'Conversations Today', value: stats?.total_conversations_today || 0, color: 'text-blue-600' },
        ].map(s => (
          <div key={s.label} className="bg-white p-6 rounded-lg shadow border border-gray-200">
            <p className="text-sm font-medium text-gray-500">{s.label}</p>
            <p className={`mt-2 text-3xl font-semibold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tenants table */}
      <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Registered Tenants</h2>
        </div>
        <div className="px-6 py-3 border-b border-gray-200 flex gap-2">
          {industryTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setIndustryFilter(tab.key)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                industryFilter === tab.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tenant</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Industry</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plan</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">WhatsApp</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bookings (30d)</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Convs (30d)</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Joined</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-6 py-8 text-center text-sm text-gray-500">
                    No tenants in this category
                  </td>
                </tr>
              ) : filteredTenants.map(t => (
                <tr key={t.id}>
                  <td className="px-3 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{t.name}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{industryBadge(t.industry)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-indigo-100 text-indigo-800 capitalize">{t.plan}</span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {statusBadge(t.status)}
                    {failureCounts[t.id] > 0 && (
                      <button
                        type="button"
                        onClick={() => navigate(`/superadmin/tenants/${t.id}`)}
                        title="Open the tenant page to see the failed sends"
                        className="ml-2 px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800 hover:bg-red-200"
                      >
                        {failureCounts[t.id]} failed (24h)
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500">
                    {t.whatsapp_number || <span className="text-gray-300">—</span>}
                    {t.whatsapp_number_placeholder && (
                      <span className="ml-2 px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-amber-100 text-amber-800">Placeholder</span>
                    )}
                    {t.whatsapp_connected === false && (
                      <span className="ml-2 px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-500">Not connected</span>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500">{t.booking_count}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500">{t.conversation_count}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500">{new Date(t.created_at).toLocaleDateString('en-IN')}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-right text-sm font-medium space-x-3">
                    <button onClick={() => navigate(`/superadmin/tenants/${t.id}`)} className="text-indigo-600 hover:text-indigo-900">Edit</button>
                    {t.id === ownTenantId && (
                      <span className="inline-flex text-xs leading-5 font-semibold text-gray-400">(You)</span>
                    )}
                    {t.id !== ownTenantId && (
                      <button onClick={() => handleClearConversations(t)} className="text-orange-600 hover:text-orange-900">Clear Chats</button>
                    )}
                    {t.id !== ownTenantId && (
                      <button
                        onClick={() => handleStatusChange(t.id, t.status)}
                        className={
                          t.status === 'pending' ? 'text-green-600 hover:text-green-900' :
                            t.status === 'active' ? 'text-red-600 hover:text-red-900' :
                              'text-green-600 hover:text-green-900'
                        }
                      >
                        {t.status === 'pending' ? 'Approve' : t.status === 'active' ? 'Suspend' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Clinic Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">New Clinic Account</h2>
            {createError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{createError}</p>}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Clinic Name</label>
              <input
                type="text"
                value={createForm.clinicName}
                onChange={e => setCreateForm(f => ({ ...f, clinicName: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Apollo Medical Centre"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Admin Email</label>
              <input
                type="email"
                value={createForm.email}
                onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="doctor@clinic.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={createForm.password}
                onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Min 8 characters"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plan</label>
              <select
                value={createForm.plan}
                onChange={e => setCreateForm(f => ({ ...f, plan: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {PLANS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
              <select
                value={createForm.industry}
                onChange={e => setCreateForm(f => ({ ...f, industry: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="clinic">Clinic</option>
                <option value="enquiry">Enquiry</option>
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setShowCreate(false); setCreateError(''); }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={createLoading}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {createLoading ? 'Creating...' : 'Create Clinic'}
              </button>
            </div>
          </div>
        </div>
      )}

      </>}
    </div>
  );
}

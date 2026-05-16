import React, { useState, useEffect } from 'react';
import { getAllTenants, getPlatformStats, updateTenantStatus, updateTenant, createTenant } from '../services/superadmin.service';
import useStore from '../store/useStore';
import { StatCardSkeleton, TableRowSkeleton } from '../components/shared/Skeleton';

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

export default function SuperAdmin() {
  const { staff } = useStore();



  const [stats, setStats] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ clinicName: '', email: '', password: '', plan: 'starter' });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Edit modal
  const [editTenant, setEditTenant] = useState(null);
  const [editForm, setEditForm] = useState({ clinicName: '', plan: '', whatsappNumber: '' });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  if (staff?.role !== 'super_admin') {
    return <div className="p-8 text-red-600 font-medium">Access Denied. Super Admin only.</div>;
  }

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [statsRes, tenantsRes] = await Promise.all([
        getPlatformStats().catch(() => ({ data: {} })),
        getAllTenants().catch(() => ({ data: [] }))
      ]);
      setStats(statsRes.data || {});
      setTenants(Array.isArray(tenantsRes.data) ? tenantsRes.data : []);
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
      setCreateForm({ clinicName: '', email: '', password: '', plan: 'starter' });
      fetchData();
    } catch (err) {
      setCreateError(err?.response?.data?.error || 'Failed to create clinic');
    } finally {
      setCreateLoading(false);
    }
  };

  const openEdit = (t) => {
    setEditTenant(t);
    setEditForm({ clinicName: t.name, plan: t.plan, whatsappNumber: t.whatsapp_number || '' });
    setEditError('');
  };

  const handleEdit = async () => {
    setEditError('');
    try {
      setEditLoading(true);
      await updateTenant(editTenant.id, editForm);
      setEditTenant(null);
      fetchData();
    } catch (err) {
      setEditError(err?.response?.data?.error || 'Failed to update clinic');
    } finally {
      setEditLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 space-y-8">
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

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Platform Admin</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          + New Clinic
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: 'Total Clinics', value: stats?.total_tenants || 0, color: 'text-gray-900' },
          { label: 'Active Clinics', value: stats?.active_tenants || 0, color: 'text-green-600' },
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
          <h2 className="text-lg font-medium text-gray-900">Registered Clinics</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Clinic</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plan</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">WhatsApp</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bookings (30d)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Convs (30d)</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Joined</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {tenants.map(t => (
                <tr key={t.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{t.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800 capitalize">{t.plan}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">{statusBadge(t.status)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{t.whatsapp_number || <span className="text-gray-300">—</span>}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{t.booking_count}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{t.conversation_count}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(t.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                    <button onClick={() => openEdit(t)} className="text-blue-600 hover:text-blue-900">Edit</button>
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
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="Apollo Medical Centre"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Admin Email</label>
              <input
                type="email"
                value={createForm.email}
                onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="doctor@clinic.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={createForm.password}
                onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="Min 8 characters"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plan</label>
              <select
                value={createForm.plan}
                onChange={e => setCreateForm(f => ({ ...f, plan: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {PLANS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
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
                className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
              >
                {createLoading ? 'Creating...' : 'Create Clinic'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Clinic Modal */}
      {editTenant && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Edit Clinic</h2>
            {editError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{editError}</p>}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Clinic Name</label>
              <input
                type="text"
                value={editForm.clinicName}
                onChange={e => setEditForm(f => ({ ...f, clinicName: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plan</label>
              <select
                value={editForm.plan}
                onChange={e => setEditForm(f => ({ ...f, plan: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {PLANS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Number</label>
              <input
                type="text"
                value={editForm.whatsappNumber}
                onChange={e => setEditForm(f => ({ ...f, whatsappNumber: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="+919876543210"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setEditTenant(null)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleEdit}
                disabled={editLoading}
                className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
              >
                {editLoading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

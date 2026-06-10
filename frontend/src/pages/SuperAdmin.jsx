import React, { useState, useEffect } from 'react';
import { getAllTenants, getPlatformStats, updateTenantStatus, updateTenant, createTenant, clearTenantConversations } from '../services/superadmin.service';
import useStore from '../store/useStore';
import api from '../utils/api';
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
  const { staff, addToast } = useStore();



  const [stats, setStats] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [industryFilter, setIndustryFilter] = useState('all');

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ clinicName: '', email: '', password: '', plan: 'starter', industry: 'clinic' });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Edit modal
  const [editTenant, setEditTenant] = useState(null);
  const [editForm, setEditForm] = useState({ clinicName: '', plan: '', whatsappNumber: '', industry: 'clinic' });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  // WhatsApp WABA registration
  const [wabaPhone, setWabaPhone] = useState('');
  const [wabaPhoneNumberId, setWabaPhoneNumberId] = useState('');
  const [wabaOtp, setWabaOtp] = useState('');
  const [wabaStep, setWabaStep] = useState('idle'); // idle | sending | otp_sent | verifying | done
  const [wabaError, setWabaError] = useState('');

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
      setCreateForm({ clinicName: '', email: '', password: '', plan: 'starter', industry: 'clinic' });
      fetchData();
    } catch (err) {
      setCreateError(err?.response?.data?.error || 'Failed to create clinic');
    } finally {
      setCreateLoading(false);
    }
  };

  const openEdit = (t) => {
    setEditTenant(t);
    setEditForm({ clinicName: t.name, plan: t.plan, whatsappNumber: t.whatsapp_number || '', industry: t.industry || 'clinic' });
    setEditError('');
  };

  const handleEdit = async () => {
    setEditError('');
    try {
      setEditLoading(true);
      await updateTenant(editTenant.id, editForm);
      closeEditModal();
      fetchData();
    } catch (err) {
      setEditError(err?.response?.data?.error || 'Failed to update clinic');
    } finally {
      setEditLoading(false);
    }
  };


  const closeEditModal = () => {
    setEditTenant(null);
    setWabaStep('idle');
    setWabaPhone('');
    setWabaOtp('');
    setWabaPhoneNumberId('');
    setWabaError('');
  };

  const handleSendOTP = async () => {
    if (!wabaPhone || !editTenant?.id) return;
    setWabaStep('sending');
    setWabaError('');
    try {
      const res = await api.post('/admin/waba/initiate', {
        phone_number: wabaPhone,
        tenant_id: editTenant.id
      });
      setWabaPhoneNumberId(res.data?.phone_number_id || res.phone_number_id);
      setWabaStep('otp_sent');
    } catch (err) {
      setWabaError(err.error || 'Failed to send OTP');
      setWabaStep('idle');
    }
  };

  const handleVerifyOTP = async () => {
    if (!wabaOtp || !wabaPhoneNumberId) return;
    setWabaStep('verifying');
    setWabaError('');
    try {
      await api.post('/admin/waba/verify', {
        phone_number_id: wabaPhoneNumberId,
        code: wabaOtp,
        tenant_id: editTenant.id,
        phone_number: wabaPhone
      });
      setWabaStep('done');
      addToast('WhatsApp number registered successfully', 'success');
      fetchData();
    } catch (err) {
      setWabaError(err.error || 'Invalid OTP');
      setWabaStep('otp_sent');
    }
  };

  const handleDeleteClinic = async (tenantId, clinicName) => {
    const confirmed = window.prompt(`Type "${clinicName}" to confirm permanent deletion:`);
    if (confirmed !== clinicName) {
      if (confirmed !== null) addToast('Clinic name did not match', 'error');
      return;
    }
    try {
      await api.delete(`/superadmin/tenants/${tenantId}`);
      addToast('Clinic deleted permanently', 'success');
      closeEditModal();
      fetchData();
    } catch {
      addToast('Failed to delete clinic', 'error');
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
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Platform Admin</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          + New Tenant
        </button>
      </div>

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
                  ? 'bg-teal-600 text-white'
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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tenant</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Industry</th>
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
              {filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-6 py-8 text-center text-sm text-gray-500">
                    No tenants in this category
                  </td>
                </tr>
              ) : filteredTenants.map(t => (
                <tr key={t.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{t.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{industryBadge(t.industry)}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800 capitalize">{t.plan}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">{statusBadge(t.status)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{t.whatsapp_number || <span className="text-gray-300">—</span>}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{t.booking_count}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{t.conversation_count}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(t.created_at).toLocaleDateString('en-IN')}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                    <button onClick={() => openEdit(t)} className="text-blue-600 hover:text-blue-900">Edit</button>
                    <button onClick={() => handleClearConversations(t)} className="text-orange-600 hover:text-orange-900">Clear Chats</button>                    <button
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
              <select
                value={createForm.industry}
                onChange={e => setCreateForm(f => ({ ...f, industry: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">
          <div className="p-6 space-y-4 overflow-y-auto flex-1">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Industry</label>
              <select
                value={editForm.industry}
                onChange={e => setEditForm(f => ({ ...f, industry: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="clinic">Clinic</option>
                <option value="enquiry">Enquiry</option>
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

            {/* WhatsApp WABA Registration */}
            <div className="border-t pt-4 mt-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">📱 Register WhatsApp Number</h4>
              {wabaStep === 'done' ? (
                <div className="text-sm text-green-600 font-medium">✅ WhatsApp number registered successfully</div>
              ) : (
                <div className="space-y-3">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
                    ⚠️ After registration, WhatsApp app will stop working on this number. All messages will be handled by ReceptionAI.
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="91XXXXXXXXXX"
                      value={wabaPhone}
                      onChange={e => setWabaPhone(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      disabled={wabaStep === 'otp_sent' || wabaStep === 'sending'}
                    />
                    <button
                      onClick={handleSendOTP}
                      disabled={wabaStep === 'sending' || wabaStep === 'otp_sent' || !wabaPhone}
                      className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
                    >
                      {wabaStep === 'sending' ? 'Sending...' : 'Send OTP'}
                    </button>
                  </div>
                  {wabaStep === 'otp_sent' && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Enter 6-digit OTP"
                        value={wabaOtp}
                        onChange={e => setWabaOtp(e.target.value)}
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                      <button
                        onClick={handleVerifyOTP}
                        disabled={wabaStep === 'verifying' || !wabaOtp}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {wabaStep === 'verifying' ? 'Verifying...' : 'Verify OTP'}
                      </button>
                    </div>
                  )}
                  {wabaError && (
                    <p className="text-red-600 text-xs">{wabaError}</p>
                  )}
                </div>
              )}
            </div>

            </div>{/* end scrollable body */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between flex-shrink-0">
              <div>
                {editTenant?.status === 'suspended' && (
                  <button
                    type="button"
                    onClick={() => handleDeleteClinic(editTenant.id, editTenant.name)}
                    className="px-4 py-2 text-red-600 border border-red-200 rounded-md hover:bg-red-50 text-sm font-medium"
                  >
                    Delete Permanently
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => closeEditModal()}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEdit}
                  disabled={editLoading}
                  className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
                >
                  {editLoading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

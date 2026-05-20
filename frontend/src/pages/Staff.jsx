import React, { useState, useEffect } from 'react';
import { getStaff, inviteStaff, updateStaff, deleteStaff, activateStaff, deleteStaffPermanently } from '../services/staff.service';
import useStore from '../store/useStore';
import { CardSkeleton } from '../components/shared/Skeleton';

const Staff = () => {
  const { addToast } = useStore();
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [isInviteModalOpen, setInviteModalOpen] = useState(false);
  const [editRoleModal, setEditRoleModal] = useState(null);

  // Invite Form State
  const [inviteData, setInviteData] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'receptionist',
    specialization: '',
    doctor_id: ''
  });
  const [doctors, setDoctors] = useState([]);
  const [inviteError, setInviteError] = useState('');
  const [filterTab, setFilterTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchStaff();
  }, []);

  useEffect(() => {
    if (isInviteModalOpen) {
      import('../services/clinic.service').then(m => {
        m.getDoctors().then(res => setDoctors(res.data?.doctors || res.data || []));
      });
    }
  }, [isInviteModalOpen]);

  const fetchStaff = async () => {
    try {
      setLoading(true);
      const res = await getStaff();
      setStaffList(res.data?.staff || res.staff || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviteError('');
    const emailExists = staffList.some(s => s.email?.toLowerCase() === inviteData.email.toLowerCase());
    if (emailExists) {
      setInviteError('A staff member with this email already exists');
      return;
    }
    try {
      await inviteStaff(inviteData);
      addToast('Staff member invited successfully', 'success');
      setInviteModalOpen(false);
      setInviteData({ name: '', email: '', phone: '', role: 'receptionist', specialization: '', doctor_id: '' });
      fetchStaff();
    } catch (err) {
      addToast(err?.error || err.response?.data?.error || 'Failed to invite staff', 'error');
    }
  };

  const handleUpdateRole = async (e) => {
    e.preventDefault();
    if (!editRoleModal) return;
    try {
      await updateStaff(editRoleModal.id, { role: editRoleModal.role });
      setEditRoleModal(null);
      fetchStaff();
    } catch (err) {
      addToast(err?.error || err.response?.data?.error || 'Failed to update role', 'error');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to deactivate this staff member?')) return;
    try {
      await deleteStaff(id);
      fetchStaff();
    } catch (err) {
      addToast('Failed to deactivate staff', 'error');
    }
  };

  const handleActivate = async (id) => {
    if (!window.confirm('Reactivate this staff member?')) return;
    try {
      await activateStaff(id);
      addToast('Staff member reactivated', 'success');
      fetchStaff();
    } catch {
      addToast('Failed to reactivate staff', 'error');
    }
  };

  const handleDeletePermanent = async (id) => {
    if (!window.confirm('Permanently delete this staff member? This cannot be undone.')) return;
    try {
      await deleteStaffPermanently(id);
      addToast('Staff member deleted', 'success');
      setEditRoleModal(null);
      fetchStaff();
    } catch {
      addToast('Failed to delete staff', 'error');
    }
  };

  // ── Role style maps ──────────────────────────────────────────────────────────
  const ROLE_AVATAR_BG = {
    doctor: 'bg-teal-500',
    admin: 'bg-indigo-500',
    manager: 'bg-purple-600',
    receptionist: 'bg-orange-500',
    super_admin: 'bg-gray-600',
  };

  const ROLE_BADGE = {
    doctor: 'bg-teal-100 text-teal-700',
    admin: 'bg-indigo-100 text-indigo-700',
    manager: 'bg-purple-100 text-purple-700',
    receptionist: 'bg-orange-100 text-orange-700',
    super_admin: 'bg-gray-100 text-gray-700',
  };

  const TABS = [
    { key: 'all', label: 'All' },
    { key: 'doctor', label: 'Doctors' },
    { key: 'admin', label: 'Admins' },
    { key: 'receptionist', label: 'Receptionists' },
    { key: 'manager', label: 'Managers' },
  ];

  const filteredStaff = staffList
    .filter(s => filterTab === 'all' || s.role === filterTab)
    .filter(s => !searchQuery ||
      s.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.email?.toLowerCase().includes(searchQuery.toLowerCase())
    );

  function staffInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(' ').filter(Boolean);
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  return (
    <div className="p-8 space-y-6">

      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff Management</h1>
          <p className="text-sm text-indigo-600 mt-0.5">
            {staffList.length} staff members · Manage team access, roles &amp; permissions
          </p>
        </div>
        <button
          onClick={() => setInviteModalOpen(true)}
          className="bg-indigo-600 text-white px-4 py-2.5 rounded-lg shadow-sm hover:bg-indigo-700 font-semibold text-sm"
        >
          + Invite Staff
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Staff', value: staffList.length, color: 'text-gray-900' },
          { label: 'Doctors', value: staffList.filter(s => s.role === 'doctor').length, color: 'text-teal-600' },
          { label: 'Active Today', value: staffList.filter(s => s.is_active).length, color: 'text-green-600' },
          { label: 'Inactive', value: staffList.filter(s => !s.is_active).length, color: 'text-red-500' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{card.label}</p>
            <p className={`text-3xl font-black ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Filter Tabs + Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex gap-1.5 flex-wrap">
          {TABS.map(tab => {
            const count = tab.key === 'all'
              ? staffList.length
              : staffList.filter(s => s.role === tab.key).length;
            return (
              <button
                key={tab.key}
                onClick={() => setFilterTab(tab.key)}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition ${
                  filterTab === tab.key
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tab.label}
                <span className={`ml-1.5 text-xs font-semibold ${filterTab === tab.key ? 'text-indigo-200' : 'text-gray-400'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <input
          type="text"
          placeholder="Search staff by name or email"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full sm:w-64 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </div>

      {/* Staff Table */}
      {loading ? (
        <CardSkeleton />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {filteredStaff.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <svg className="w-12 h-12 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
                  d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              <p className="text-gray-500 font-medium">
                {searchQuery ? 'No staff match your search' : 'No staff members yet'}
              </p>
              {!searchQuery && (
                <button
                  onClick={() => setInviteModalOpen(true)}
                  className="mt-3 text-indigo-600 font-semibold text-sm hover:text-indigo-800"
                >
                  + Invite Staff
                </button>
              )}
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-100">
              <thead>
                <tr className="bg-gray-50">
                  {['Name', 'Email', 'Role', 'Status', 'Actions'].map((col, i) => (
                    <th
                      key={col}
                      className={`px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider ${i === 4 ? 'text-right' : 'text-left'}`}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredStaff.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">

                    {/* Name + Avatar */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${ROLE_AVATAR_BG[s.role] || 'bg-gray-400'}`}>
                          {staffInitials(s.name)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{s.name}</p>
                          {s.phone && <p className="text-xs text-gray-400">{s.phone}</p>}
                        </div>
                      </div>
                    </td>

                    {/* Email */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{s.email || '—'}</td>

                    {/* Role Badge */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${ROLE_BADGE[s.role] || 'bg-gray-100 text-gray-700'}`}>
                        {s.role}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.is_active ? 'bg-green-500' : 'bg-red-400'}`} />
                        <span className={`text-sm font-medium ${s.is_active ? 'text-green-700' : 'text-red-500'}`}>
                          {s.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditRoleModal({ id: s.id, role: s.role })}
                          title="Edit role"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        {s.is_active ? (
                          <button
                            onClick={() => handleDelete(s.id)}
                            className="text-xs font-semibold text-red-500 hover:text-red-700 px-2.5 py-1 rounded-lg hover:bg-red-50 transition"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => handleActivate(s.id)}
                              className="text-xs font-semibold text-green-600 hover:text-green-800 px-2.5 py-1 rounded-lg hover:bg-green-50 transition"
                            >
                              Activate
                            </button>
                            <button
                              onClick={() => handleDeletePermanent(s.id)}
                              className="text-xs font-semibold text-red-500 hover:text-red-700 px-2.5 py-1 rounded-lg hover:bg-red-50 transition"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Invite Modal */}
      {isInviteModalOpen && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Invite Staff Member</h2>
            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Name <span className="text-red-500">*</span></label>
                <input required type="text" value={inviteData.name} onChange={e => setInviteData({ ...inviteData, name: e.target.value.replace(/\b\w/g, c => c.toUpperCase()) })} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Email <span className="text-red-500">*</span></label>
                <input required type="email" value={inviteData.email} onChange={e => setInviteData({ ...inviteData, email: e.target.value })} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Phone</label>
                <input type="text" value={inviteData.phone} onChange={e => setInviteData({ ...inviteData, phone: e.target.value })} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Role</label>
                <select value={inviteData.role} onChange={e => setInviteData({ ...inviteData, role: e.target.value })} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border">
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="doctor">Doctor</option>
                  <option value="receptionist">Receptionist</option>
                </select>
              </div>
              {inviteData.role === 'doctor' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Link to Doctor Record <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={inviteData.doctor_id || ''}
                      onChange={e => setInviteData({ ...inviteData, doctor_id: e.target.value })}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border"
                      required
                    >
                      <option value="">Select doctor...</option>
                      {doctors.map(d => (
                        <option key={d.id} value={d.id}>{d.name} ({d.specialization})</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">Links this staff login to the doctor's schedule and patients</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Specialization</label>
                    <input type="text" value={inviteData.specialization} onChange={e => setInviteData({ ...inviteData, specialization: e.target.value })} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border" />
                  </div>
                </>
              )}

              {inviteError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{inviteError}</p>
              )}
              <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
                <button type="button" onClick={() => { setInviteModalOpen(false); setInviteError(''); }} className="px-4 py-2 border rounded-md text-gray-700 bg-white hover:bg-gray-50">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white flex-1 rounded-md hover:bg-indigo-700 font-medium shadow-sm">Send Invite</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Role Modal */}
      {editRoleModal && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full shadow-xl">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Edit Role</h2>
            <form onSubmit={handleUpdateRole} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">New Role</label>
                <select value={editRoleModal.role} onChange={e => setEditRoleModal({ ...editRoleModal, role: e.target.value })} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border">
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="doctor">Doctor</option>
                  <option value="receptionist">Receptionist</option>
                </select>
              </div>
              <div className="flex justify-between mt-6 pt-4 border-t">
                <div>
                  {editRoleModal && !staffList.find(s => s.id === editRoleModal.id)?.is_active && (
                    <button type="button" onClick={() => handleDeletePermanent(editRoleModal.id)} className="px-4 py-2 text-red-600 border border-red-200 rounded-md hover:bg-red-50 text-sm font-medium">
                      Delete Permanently
                    </button>
                  )}
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setEditRoleModal(null)} className="px-4 py-2 border rounded-md text-gray-700 bg-white hover:bg-gray-50">Cancel</button>
                  <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">Save Changes</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Staff;

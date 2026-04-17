import React, { useState, useEffect } from 'react';
import { getStaff, inviteStaff, updateStaff, deleteStaff } from '../services/staff.service';

const Staff = () => {
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
    specialization: ''
  });

  useEffect(() => {
    fetchStaff();
  }, []);

  const fetchStaff = async () => {
    try {
      setLoading(true);
      const res = await getStaff();
      setStaffList(res.data?.staff || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    try {
      await inviteStaff(inviteData);
      setInviteModalOpen(false);
      setInviteData({ name: '', email: '', phone: '', role: 'receptionist', specialization: '' });
      fetchStaff();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to invite staff');
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
      alert(err.response?.data?.error || 'Failed to update role');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to deactivate this staff member?')) return;
    try {
      await deleteStaff(id);
      fetchStaff();
    } catch (err) {
      alert('Failed to deactivate staff');
    }
  };

  const roleColors = {
    super_admin: 'bg-purple-100 text-purple-800',
    admin: 'bg-indigo-100 text-indigo-800',
    manager: 'bg-blue-100 text-blue-800',
    doctor: 'bg-green-100 text-green-800',
    receptionist: 'bg-gray-100 text-gray-800'
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Staff Management</h1>
        <button 
          onClick={() => setInviteModalOpen(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-md shadow hover:bg-indigo-700 font-medium"
        >
          + Invite Staff
        </button>
      </div>

      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan="5" className="text-center py-4">Loading...</td></tr>
            ) : staffList.length === 0 ? (
              <tr><td colSpan="5" className="text-center py-4 text-gray-500">No staff found</td></tr>
            ) : staffList.map(s => (
              <tr key={s.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">{s.name}</div>
                  <div className="text-sm text-gray-500">{s.phone}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{s.email || '-'}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${roleColors[s.role] || 'bg-gray-100 text-gray-800'}`}>
                    {s.role}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {s.is_active ? (
                    <span className="text-green-600 font-medium text-sm">Active</span>
                  ) : (
                    <span className="text-red-500 font-medium text-sm">Inactive</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                  <button onClick={() => setEditRoleModal({ id: s.id, role: s.role })} className="text-indigo-600 hover:text-indigo-900">Edit Role</button>
                  {s.is_active && (
                     <button onClick={() => handleDelete(s.id)} className="text-red-600 hover:text-red-900">Deactivate</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Invite Modal */}
      {isInviteModalOpen && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Invite Staff Member</h2>
            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Name <span className="text-red-500">*</span></label>
                <input required type="text" value={inviteData.name} onChange={e => setInviteData({...inviteData, name: e.target.value})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Email <span className="text-red-500">*</span></label>
                <input required type="email" value={inviteData.email} onChange={e => setInviteData({...inviteData, email: e.target.value})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Phone</label>
                <input type="text" value={inviteData.phone} onChange={e => setInviteData({...inviteData, phone: e.target.value})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Role</label>
                <select value={inviteData.role} onChange={e => setInviteData({...inviteData, role: e.target.value})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border">
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="doctor">Doctor</option>
                  <option value="receptionist">Receptionist</option>
                </select>
              </div>
              {inviteData.role === 'doctor' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Specialization</label>
                  <input type="text" value={inviteData.specialization} onChange={e => setInviteData({...inviteData, specialization: e.target.value})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border" />
                </div>
              )}
              
              <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
                <button type="button" onClick={() => setInviteModalOpen(false)} className="px-4 py-2 border rounded-md text-gray-700 bg-white hover:bg-gray-50">Cancel</button>
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
                <select value={editRoleModal.role} onChange={e => setEditRoleModal({...editRoleModal, role: e.target.value})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50 border">
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="doctor">Doctor</option>
                  <option value="receptionist">Receptionist</option>
                </select>
              </div>
              <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
                <button type="button" onClick={() => setEditRoleModal(null)} className="px-4 py-2 border rounded-md text-gray-700 bg-white hover:bg-gray-50">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Staff;

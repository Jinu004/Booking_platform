import React, { useState, useEffect } from 'react';
import { getAllTenants, getPlatformStats, updateTenantStatus } from '../services/superadmin.service';
import useStore from '../store/useStore';
import { StatCardSkeleton, TableRowSkeleton } from '../components/shared/Skeleton';

const SuperAdmin = () => {
  const { staff } = useStore();
  const [stats, setStats] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);

  if (staff?.role !== 'super_admin') {
    return <div className="p-8">Access Denied. You are not a Super Admin.</div>;
  }

  useEffect(() => {
    fetchData();
  }, []);

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

  const handleToggleStatus = async (id, currentStatus) => {
    if(!window.confirm(`Are you sure you want to ${currentStatus === 'active' ? 'suspend' : 'activate'} this clinic?`)) return;
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    try {
      await updateTenantStatus(id, newStatus);
      fetchData();
    } catch (err) {
      alert('Failed to update status');
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
      <h1 className="text-2xl font-bold text-gray-900">Platform Admin</h1>
      
      {/* Top stats row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
          <p className="text-sm font-medium text-gray-500 truncate">Total Clinics</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{stats?.total_tenants || 0}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
          <p className="text-sm font-medium text-gray-500 truncate">Active Clinics</p>
          <p className="mt-2 text-3xl font-semibold text-green-600">{stats?.active_tenants || 0}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
          <p className="text-sm font-medium text-gray-500 truncate">Bookings Today</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{stats?.total_bookings_today || 0}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
          <p className="text-sm font-medium text-gray-500 truncate">Conversations Today</p>
          <p className="mt-2 text-3xl font-semibold text-blue-600">{stats?.total_conversations_today || 0}</p>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Registered Clinics</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Clinic Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plan</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
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
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize"><span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">{t.plan}</span></td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${t.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{t.booking_count}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{t.conversation_count}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(t.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button 
                      onClick={() => handleToggleStatus(t.id, t.status)} 
                      className={t.status === 'active' ? 'text-red-600 hover:text-red-900' : 'text-green-600 hover:text-green-900'}
                    >
                      {t.status === 'active' ? 'Suspend' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SuperAdmin;

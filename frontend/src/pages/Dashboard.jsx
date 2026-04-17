import React, { useState, useEffect } from 'react';
import { getBookingStats, getBookings } from '../services/booking.service';
import { getDoctors, getTokenQueue } from '../services/clinic.service';
import { getConversations } from '../services/conversation.service';

const Dashboard = () => {
  const [stats, setStats] = useState({
    bookingsToday: 0,
    activeConversations: 0,
    availableDoctors: 0,
    pendingTokens: 0
  });

  const [recentBookings, setRecentBookings] = useState([]);
  const [recentConversations, setRecentConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000); // 30s auto-refresh
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [
        statsRes,
        convRes,
        docsRes,
        tokensRes,
        bookingsRes
      ] = await Promise.all([
        getBookingStats().catch(() => ({ data: { total: 0 } })),
        getConversations({ status: 'active' }).catch(() => ({ data: { conversations: [] } })),
        getDoctors(true).catch(() => ({ data: [] })),
        getTokenQueue().catch(() => ({ data: [] })),
        getBookings({ limit: 5 }).catch(() => ({ data: { bookings: [] } }))
      ]);

      // Doctor stats
      const docsArray = Array.isArray(docsRes.data) ? docsRes.data : (Array.isArray(docsRes) ? docsRes : []);
      
      // Tokens stats
      const tokensArray = Array.isArray(tokensRes.data) ? tokensRes.data : (Array.isArray(tokensRes) ? tokensRes : []);
      const waitingTokens = tokensArray.filter(t => t.status === 'waiting');

      // Conversations stats
      let activeConvs = [];
      if (convRes.data?.conversations) activeConvs = convRes.data.conversations;
      else if (convRes.conversations) activeConvs = convRes.conversations;
      else if (Array.isArray(convRes.data)) activeConvs = convRes.data;
      else if (Array.isArray(convRes)) activeConvs = convRes;

      // Bookings stats
      let totalBookings = 0;
      if (statsRes.data?.total !== undefined) totalBookings = statsRes.data.total;
      else if (statsRes.total !== undefined) totalBookings = statsRes.total;

      // Recent Bookings
      let bookingsArray = [];
      if (bookingsRes.data?.bookings) bookingsArray = bookingsRes.data.bookings;
      else if (bookingsRes.bookings) bookingsArray = bookingsRes.bookings;
      else if (Array.isArray(bookingsRes.data)) bookingsArray = bookingsRes.data;
      else if (Array.isArray(bookingsRes)) bookingsArray = bookingsRes;

      setStats({
        bookingsToday: totalBookings,
        activeConversations: activeConvs.length,
        availableDoctors: docsArray.length,
        pendingTokens: waitingTokens.length
      });

      setRecentConversations(activeConvs.slice(0, 5));
      setRecentBookings(bookingsArray.slice(0, 5));
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
    noshow: 'bg-gray-100 text-gray-800'
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading Dashboard...</div>;
  }

  return (
    <div className="p-8 space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      
      {/* 4 Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
          <p className="text-sm font-medium text-gray-500 truncate">Today's Bookings</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{stats.bookingsToday}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
          <p className="text-sm font-medium text-gray-500 truncate">Active Conversations</p>
          <p className="mt-2 text-3xl font-semibold text-blue-600">{stats.activeConversations}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
          <p className="text-sm font-medium text-gray-500 truncate">Available Doctors</p>
          <p className="mt-2 text-3xl font-semibold text-green-600">{stats.availableDoctors}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
          <p className="text-sm font-medium text-gray-500 truncate">Pending Tokens (Waiting)</p>
          <p className="mt-2 text-3xl font-semibold text-yellow-600">{stats.pendingTokens}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Left Column: Recent Bookings */}
        <div className="bg-white shadow rounded-lg border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-lg font-medium text-gray-900">Recent Bookings</h2>
          </div>
          <div className="divide-y divide-gray-200">
            {recentBookings.length === 0 ? (
              <p className="p-6 text-sm text-gray-500 text-center">No recent bookings</p>
            ) : recentBookings.map(b => (
              <div key={b.id} className="p-6 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{b.patient_name || 'Unknown Patient'}</p>
                  <p className="text-sm text-gray-500">Dr. {b.doctor_name || 'Unassigned'}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-gray-900 mb-1">Token #{b.token_number}</p>
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusColors[b.status] || 'bg-gray-100 text-gray-800'}`}>
                    {b.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Active Conversations */}
        <div className="bg-white shadow rounded-lg border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-lg font-medium text-gray-900">Active Conversations</h2>
          </div>
          <div className="divide-y divide-gray-200">
            {recentConversations.length === 0 ? (
              <p className="p-6 text-sm text-gray-500 text-center">No active conversations</p>
            ) : recentConversations.map(c => (
              <div key={c.id} className="p-6 flex flex-col space-y-2">
                <div className="flex justify-between items-center">
                  <p className="text-sm font-medium text-gray-900">{c.customer_phone}</p>
                  <p className="text-xs text-gray-500">{new Date(c.updated_at).toLocaleTimeString()}</p>
                </div>
                <p className="text-sm text-gray-500 truncate">{c.last_message || '...'}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;

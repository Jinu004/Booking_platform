import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getBookingStats, getBookings } from '../services/booking.service';
import { getDoctors, getTokenQueue } from '../services/clinic.service';
import { getConversations } from '../services/conversation.service';
import { StatCardSkeleton, TableRowSkeleton, CardSkeleton } from '../components/shared/Skeleton';

const Dashboard = () => {
  const [stats, setStats] = useState({ bookingsToday: 0, activeConversations: 0, availableDoctors: 0, pendingTokens: 0 });
  const [recentBookings, setRecentBookings] = useState([]);
  const [tokenQueue, setTokenQueue] = useState([]);
  const [recentConversations, setRecentConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 15000); // 15s auto-refresh
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [statsRes, convRes, docsRes, tokensRes, bookingsRes] = await Promise.all([
        getBookingStats().catch(() => ({ data: { total: 0 } })),
        getConversations({ status: 'active' }).catch(() => ({ data: { conversations: [] } })),
        getDoctors(true).catch(() => ({ data: [] })),
        getTokenQueue().catch(() => ({ data: [] })),
        getBookings({ limit: 5 }).catch(() => ({ data: { bookings: [] } }))
      ]);

      const docsArray = docsRes?.data || [];
      const tokensArray = tokensRes?.data || [];
      
      let activeConvs = convRes?.data?.conversations || [];
      let totalBookings = statsRes?.data?.total || 0;
      let bookingsArray = bookingsRes?.data?.bookings || [];

      setStats({
        bookingsToday: totalBookings,
        activeConversations: activeConvs.length,
        availableDoctors: docsArray.length,
        pendingTokens: tokensArray.filter(t => t.status === 'waiting' || t.status === 'pending').length
      });

      setTokenQueue(tokensArray);
      setRecentConversations(activeConvs.slice(0, 5));
      setRecentBookings(bookingsArray.slice(0, 5));
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const statusColors = {
    waiting: 'bg-yellow-100 text-yellow-800',
    pending: 'bg-yellow-100 text-yellow-800',
    in_progress: 'bg-blue-100 text-blue-800',
    done: 'bg-green-100 text-green-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
    noshow: 'bg-gray-100 text-gray-800'
  };

  if (loading) {
    return (
      <div className="p-8 space-y-8 max-w-7xl mx-auto">
        <h1 className="text-3xl font-black text-gray-900 tracking-tight">Overview</h1>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8"><CardSkeleton /><CardSkeleton /></div>
          <div className="space-y-8"><CardSkeleton /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-3xl font-black text-gray-900 tracking-tight">Overview</h1>
        <div className="flex space-x-3 w-full md:w-auto">
          <Link to="/bookings" className="flex-1 md:flex-none text-center bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition transform hover:scale-105">
            + New Token
          </Link>
          <Link to="/analytics" className="flex-1 md:flex-none text-center px-5 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-700 font-bold hover:bg-gray-50 transition">
            Reports
          </Link>
        </div>
      </div>
      
      {/* 4 Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition duration-300 relative overflow-hidden">
          <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">Today's Tokens</p>
          <p className="mt-2 text-4xl font-black text-gray-900">{stats.bookingsToday}</p>
          <div className="absolute top-0 right-0 p-4 opacity-5 text-indigo-600">
            <svg className="w-16 h-16" fill="currentColor" viewBox="0 0 20 20"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" /><path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" /></svg>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition duration-300 relative overflow-hidden">
          <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">Waiting Tokens</p>
          <p className="mt-2 text-4xl font-black text-yellow-600">{stats.pendingTokens}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition duration-300 relative overflow-hidden">
          <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">Available Doctors</p>
          <p className="mt-2 text-4xl font-black text-emerald-600">{stats.availableDoctors}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition duration-300 relative overflow-hidden">
          <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">Chats In-progress</p>
          <p className="mt-2 text-4xl font-black text-blue-600">{stats.activeConversations}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Token Queue */}
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h2 className="text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Live Token Queue
              </h2>
            </div>
            <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
              {tokenQueue.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-50 text-gray-400 mb-4">
                     <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                  </div>
                  <p className="text-sm text-gray-500 font-medium">No tokens currently in queue</p>
                </div>
              ) : tokenQueue.map(t => (
                <div key={t.id} className="p-4 md:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between hover:bg-gray-50 transition">
                  <div className="flex items-center space-x-4 mb-3 sm:mb-0">
                    <div className="flex-shrink-0 w-12 h-12 bg-indigo-50 border-2 border-indigo-100 rounded-full flex justify-center items-center font-black text-lg text-indigo-700">
                      {t.token_number}
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 font-bold uppercase tracking-wider mb-0.5">{t.doctor_name}</p>
                      <p className="text-lg font-bold text-gray-900 leading-tight">{t.patient_name || 'Walkin Patient'}</p>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-3 w-full sm:w-auto">
                    <span className={`px-3 py-1 inline-flex text-[11px] uppercase tracking-widest font-black rounded-lg w-full sm:w-auto justify-center ${statusColors[t.status] || 'bg-gray-100 text-gray-800'}`}>
                      {t.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Sidebar - Conversations & Quick Links */}
        <div className="space-y-8">
          <div className="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/50">
              <h2 className="text-lg font-black text-gray-900 tracking-tight">Active Chats</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {recentConversations.length === 0 ? (
                <p className="p-8 text-sm text-gray-500 text-center font-medium">No active chats</p>
              ) : recentConversations.map(c => (
                <div key={c.id} className="p-5 hover:bg-gray-50 transition cursor-pointer">
                  <div className="flex justify-between items-center mb-1">
                    <p className="text-sm font-bold text-gray-900">{c.customer_phone}</p>
                    <p className="text-xs text-gray-400 font-medium tracking-wide">{new Date(c.updated_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                  </div>
                  <p className="text-sm text-gray-500 truncate leading-relaxed">{c.last_message || 'New conversation started'}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-100 p-3 bg-gray-50 text-center">
              <Link to="/conversations" className="text-sm font-bold text-indigo-600 hover:text-indigo-800 uppercase tracking-widest">View All Chats &rarr;</Link>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Dashboard;

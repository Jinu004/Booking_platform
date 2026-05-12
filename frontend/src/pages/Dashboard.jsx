import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getBookingStats, getBookings } from '../services/booking.service';
import { getDoctors, getTokenQueue } from '../services/clinic.service';
import { getConversations } from '../services/conversation.service';
import { StatCardSkeleton, TableRowSkeleton, CardSkeleton } from '../components/shared/Skeleton';
import useStore from '../store/useStore';
import { getStoredStaff } from '../services/auth.service';

const Dashboard = () => {
  const [stats, setStats] = useState({ bookingsToday: 0, activeConversations: 0, availableDoctors: 0, pendingTokens: 0 });
  const [recentBookings, setRecentBookings] = useState([]);
  const [tokenQueue, setTokenQueue] = useState([]);
  const [recentConversations, setRecentConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const { tenant } = useStore();
  const [hasDoctors, setHasDoctors] = useState(true);
  const [doctors, setDoctors] = useState([]);
  const [availableDoctors, setAvailableDoctors] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const staff = getStoredStaff();

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 15000);
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [statsRes, convRes, docsRes, allDocsRes, tokensRes, bookingsRes] = await Promise.all([
        getBookingStats().catch(() => ({ data: { total: 0 } })),
        getConversations({ status: 'active' }).catch(() => ({ data: { conversations: [] } })),
        getDoctors(true).catch(() => ({ data: [] })),
        getDoctors().catch(() => ({ data: [] })),
        getTokenQueue().catch(() => ({ data: [] })),
        getBookings({ limit: 5 }).catch(() => ({ data: { bookings: [] } }))
      ]);

      const docsArray = allDocsRes?.data || [];
      const availableDocsArray = docsRes?.data || [];
      const tokensArray = tokensRes?.data || [];

      let activeConvs = Array.isArray(convRes?.data) ? convRes.data : (convRes?.data?.conversations || []);
      let totalBookings = statsRes?.data?.total || 0;
      let bookingsArray = bookingsRes?.data?.bookings || [];

      setStats({
        bookingsToday: totalBookings,
        activeConversations: activeConvs.length,
        availableDoctors: availableDocsArray.length,
        pendingTokens: tokensArray.filter(t => t.status === 'waiting' || t.status === 'pending').length
      });

      setTokenQueue(tokensArray);
      setRecentConversations(activeConvs.slice(0, 5));
      setRecentBookings(bookingsArray.slice(0, 5));
      setDoctors(docsArray);
      setAvailableDoctors(availableDocsArray);

      const hasDoctorsCheck = docsArray.length > 0;
      setHasDoctors(hasDoctorsCheck);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredTokens = activeFilter === 'all' ? tokenQueue
    : activeFilter === 'waiting' ? tokenQueue.filter(t => t.status === 'waiting' || t.status === 'pending')
      : activeFilter === 'in_consult' ? tokenQueue.filter(t => t.status === 'in_progress')
        : tokenQueue.filter(t => t.status === 'done' || t.status === 'completed');

  const getStatusPill = (status) => {
    switch (status) {
      case 'waiting':
      case 'pending':
        return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">Waiting</span>;
      case 'in_progress':
        return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">In Consult</span>;
      case 'done':
      case 'completed':
        return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">Done</span>;
      case 'cancelled':
        return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">Cancelled</span>;
      default:
        return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">{status}</span>;
    }
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
    <div className="min-h-screen bg-gray-50 flex flex-col gap-0">

      {/* Setup Banner */}
      {!hasDoctors && (
        <div className="mx-6 mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
          <h3 className="font-semibold text-blue-900 mb-3">👋 Complete your setup</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-green-500">✅</span>
              <span className="text-sm text-gray-700">Clinic created</span>
            </div>
            {!hasDoctors && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-gray-400">⬜</span>
                  <span className="text-sm text-gray-700">Add your first doctor</span>
                </div>
                <Link to="/doctors" className="text-sm text-blue-600 font-medium hover:underline">Add Doctor →</Link>
              </div>
            )}
            {!tenant?.whatsapp_number && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-gray-400">⬜</span>
                  <span className="text-sm text-gray-700">Connect WhatsApp</span>
                </div>
                <Link to="/settings?tab=whatsapp" className="text-sm text-blue-600 font-medium hover:underline">Learn How →</Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section 1 — Top Bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex justify-between items-center">
        <div>
          <p className="text-xl font-bold text-gray-900">{tenant?.name || staff?.tenantName || 'Dashboard'}</p>
          <p className="text-sm text-gray-500">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/bookings"
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition"
          >
            + New Token
          </Link>
        </div>
      </div>

      {/* Section 2 — Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Today's Tokens</p>
          <p className="mt-2 text-4xl font-black text-indigo-600">{stats.bookingsToday}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Waiting Now</p>
          <p className="mt-2 text-4xl font-black text-amber-500">{stats.pendingTokens}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Doctors on Duty</p>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-4xl font-black text-emerald-600">{availableDoctors.length}</span>
            <span className="text-xl text-gray-400 font-bold">/ {doctors.length}</span>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Active Chats</p>
          <p className="mt-2 text-4xl font-black text-blue-600">{stats.activeConversations}</p>
        </div>
      </div>

      {/* Section 3 — Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 px-6">

        {/* Left — Live Token Queue */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-bold text-gray-900">Live Token Queue</span>
            </div>
            <div className="flex gap-1">
              {[
                { key: 'all', label: 'All' },
                { key: 'waiting', label: 'Waiting' },
                { key: 'in_consult', label: 'In Consult' },
                { key: 'done', label: 'Done' },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveFilter(tab.key)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition ${activeFilter === tab.key
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-gray-100 max-h-[480px] overflow-y-auto">
            {filteredTokens.length === 0 ? (
              <div className="p-12 text-center text-sm text-gray-500">No tokens in queue</div>
            ) : filteredTokens.map(t => (
              <div key={t.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gray-50 rounded-lg flex items-center justify-center font-black text-indigo-600 text-sm flex-shrink-0">
                    {t.token_number}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{t.patient_name || 'Walk-in'}</p>
                    <p className="text-sm text-gray-500">{t.doctor_name}</p>
                  </div>
                </div>
                {getStatusPill(t.status)}
              </div>
            ))}
          </div>

          <div className="px-6 py-3 border-t border-gray-100 bg-gray-50">
            <p className="text-sm text-gray-500">Showing {filteredTokens.length} of {tokenQueue.length} tokens today</p>
          </div>
        </div>

        {/* Right — Active Chats */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
            <span className="font-bold text-gray-900">Active Chats</span>
            <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded-full">
              {stats.activeConversations}
            </span>
          </div>

          <div className="divide-y divide-gray-100 overflow-y-auto flex-1" style={{ maxHeight: '480px' }}>
            {recentConversations.length === 0 ? (
              <p className="p-6 text-sm text-gray-500 text-center">No active chats</p>
            ) : recentConversations.map(c => (
              <Link
                key={c.id}
                to="/conversations"
                className="flex items-start gap-3 p-4 hover:bg-gray-50 transition"
              >
                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-indigo-700">
                    {(c.patientPhone || '?')[0].toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center">
                    <p className="text-sm font-semibold text-gray-900 truncate">{c.patientPhone}</p>
                    <p className="text-xs text-gray-400 flex-shrink-0 ml-2">
                      {new Date(c.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{c.lastMessage || 'New conversation'}</p>
                  {c.mode === 'human' && (
                    <span className="text-xs text-orange-600 font-medium">● Handoff requested</span>
                  )}
                </div>
              </Link>
            ))}
          </div>

          <div className="border-t border-gray-100 px-5 py-3 bg-gray-50 flex-shrink-0">
            <Link to="/conversations" className="text-sm font-semibold text-indigo-600 hover:text-indigo-800">
              View all chats →
            </Link>
          </div>
        </div>
      </div>

      {/* Section 4 — Doctor Availability Strip */}
      <div className="px-6 pb-6 mt-4">
        <div className="flex justify-between items-center mb-4">
          <span className="font-bold text-gray-900 text-lg">Doctor Availability</span>
          <Link to="/doctors" className="text-sm text-indigo-600 font-semibold hover:text-indigo-800">Manage →</Link>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {doctors.length === 0 ? (
            <p className="text-sm text-gray-500">No doctors added yet</p>
          ) : doctors.map(d => (
            <div key={d.id} className="min-w-[160px] bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex-shrink-0">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm mb-3 ${d.available_today ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                {(d.name || '?').split(' ').filter(w => w.toLowerCase() !== 'dr.' && w.toLowerCase() !== 'dr')[0]?.[0]?.toUpperCase() || '?'}
              </div>
              <p className="font-semibold text-sm text-gray-900 truncate">{d.name}</p>
              <p className="text-xs text-gray-500 truncate mb-2">{d.specialization}</p>
              {d.available_today ? (
                <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
                  Available
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-gray-400 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block"></span>
                  Off Today
                </span>
              )}
              <div className="flex gap-3 mt-2">
                <span className="text-xs text-gray-500">
                  Seen: {tokenQueue.filter(t => t.doctor_name === d.name && (t.status === 'done' || t.status === 'completed')).length}
                </span>
                <span className="text-xs text-gray-500">
                  Queue: {tokenQueue.filter(t => t.doctor_name === d.name && (t.status === 'waiting' || t.status === 'in_progress')).length}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};

export default Dashboard;
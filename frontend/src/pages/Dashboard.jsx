import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getBookingStats, getBookings } from '../services/booking.service';
import { getDoctors, getTokenQueue, updateTokenStatus } from '../services/clinic.service';
import { getHITLConversations } from '../services/conversation.service';
import { StatCardSkeleton, TableRowSkeleton, CardSkeleton } from '../components/shared/Skeleton';
import useStore from '../store/useStore';
import { getStoredStaff } from '../services/auth.service';
import { saveToCache, loadFromCache } from '../utils/offlineCache';

const Dashboard = () => {
  const [stats, setStats] = useState({ bookingsToday: 0, activeConversations: 0, availableDoctors: 0, pendingTokens: 0 });
  const [recentBookings, setRecentBookings] = useState([]);
  const [tokenQueue, setTokenQueue] = useState([]);
  const [recentConversations, setRecentConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const { tenant, addToast } = useStore();
  const [hasDoctors, setHasDoctors] = useState(true);
  const [doctors, setDoctors] = useState([]);
  const [availableDoctors, setAvailableDoctors] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [isOffline, setIsOffline] = useState(false);
  const [loadingToken, setLoadingToken] = useState(null);
  const staff = getStoredStaff();
  const isDoctor = staff?.role === 'doctor';
  const staffDoctorId = isDoctor ? staff?.doctor_id : null;
  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 15000);
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [statsRes, convRes, docsRes, allDocsRes, tokensRes, bookingsRes] = await Promise.all([
        getBookingStats().catch(() => ({ data: { total: 0 } })),
        isDoctor ? Promise.resolve({ data: [] }) : getHITLConversations({ since: '24h' }).catch(() => ({ data: { conversations: [] } })),
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
      let bookingsArray = bookingsRes?.data?.bookings || bookingsRes?.data || [];

      const filteredByDoctor = isDoctor && staffDoctorId
        ? tokensArray.filter(t => t.doctor_id === staffDoctorId)
        : tokensArray;

      const dashboardData = {
        stats: {
          bookingsToday: isDoctor ? filteredByDoctor.length : totalBookings,
          activeConversations: activeConvs.length,
          availableDoctors: availableDocsArray.length,
          pendingTokens: filteredByDoctor.filter(t => t.status === 'arrived').length
        },
        tokenQueue: filteredByDoctor,
        recentConversations: activeConvs.slice(0, 5),
        recentBookings: bookingsArray.slice(0, 5),
        doctors: docsArray,
        availableDoctors: availableDocsArray,
        hasDoctors: docsArray.length > 0
      };

      await saveToCache('dashboard', dashboardData);

      setStats(dashboardData.stats);
      setTokenQueue(dashboardData.tokenQueue);
      setRecentConversations(dashboardData.recentConversations);
      setRecentBookings(dashboardData.recentBookings);
      setDoctors(dashboardData.doctors);
      setAvailableDoctors(dashboardData.availableDoctors);
      setHasDoctors(dashboardData.hasDoctors);
      setIsOffline(false);
    } catch (err) {
      const cached = await loadFromCache('dashboard');
      if (cached) {
        setStats(cached.stats);
        setTokenQueue(cached.tokenQueue);
        setRecentConversations(cached.recentConversations);
        setRecentBookings(cached.recentBookings);
        setDoctors(cached.doctors);
        setAvailableDoctors(cached.availableDoctors);
        setHasDoctors(cached.hasDoctors);
        setIsOffline(true);
      } else {
        addToast('Failed to load dashboard data', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const filteredTokens = activeFilter === 'all' ? tokenQueue
    : activeFilter === 'arrived' ? tokenQueue.filter(t => t.status === 'arrived')
      : activeFilter === 'in_consult' ? tokenQueue.filter(t => t.status === 'in_progress')
        : tokenQueue.filter(t => t.status === 'done' || t.status === 'completed');

  const getStatusPill = (status) => {
    switch (status) {
      case 'waiting':
      case 'pending':
        return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">Booked</span>;
      case 'arrived':
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

      {isOffline && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 text-sm text-yellow-800 flex items-center gap-2">
          <span>⚠️</span>
          <span>Offline — showing cached data. Changes won't be saved until internet is restored.</span>
        </div>
      )}

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
          <p className="text-xl font-bold text-gray-900">{isDoctor ? 'My Queue' : (tenant?.name || staff?.tenantName || 'Dashboard')}</p>
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
        {!isDoctor && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Doctors on Duty</p>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-4xl font-black text-emerald-600">{doctors.filter(d => d.available_now && !d.leave_days).length}</span>
              <span className="text-xl text-gray-400 font-bold">/ {doctors.length}</span>
            </div>
          </div>
        )}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Active Chats</p>
          <p className="mt-2 text-4xl font-black text-blue-600">{stats.activeConversations}</p>
        </div>
      </div>

      {/* Section 3 — Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 px-6">

        {/* Left — Live Token Queue */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Card header — matches Active Chats pattern */}
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-semibold text-gray-800">Live Token Queue</span>
            </div>
            <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded-full">
              {tokenQueue.length}
            </span>
          </div>
          {/* Filter tabs — full width, evenly spaced */}
          <div className="px-4 py-2 flex gap-1 border-b border-gray-100">
            {[
              { key: 'all', label: 'All' },
              { key: 'arrived', label: 'Waiting' },
              { key: 'in_consult', label: 'In Consult' },
              { key: 'done', label: 'Done' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveFilter(tab.key)}
                className={`flex-1 text-sm transition rounded-md px-3 py-1 ${
                  activeFilter === tab.key
                    ? 'bg-indigo-50 text-indigo-600 font-medium'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="divide-y divide-gray-100 max-h-[480px] overflow-y-auto">
            {filteredTokens.length === 0 ? (
              <div className="p-12 text-center text-sm text-gray-500">No tokens in queue</div>
            ) : filteredTokens.map(t => (
              <div key={t.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-50 rounded-lg flex items-center justify-center font-black text-indigo-600 text-sm flex-shrink-0">
                    {t.doctor_name ? t.doctor_name.replace(/^Dr\.\s*/i, '').charAt(0) : '?'}-{t.token_number}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{t.patient_name || 'Walk-in'}</p>
                    <p className="text-sm font-semibold text-indigo-600">{t.doctor_name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusPill(t.status)}
                  {t.status === 'waiting' && (
                    <button
                      disabled={loadingToken === t.id}
                      onClick={async () => {
                        setLoadingToken(t.id);
                        try {
                          await updateTokenStatus(t.id, 'arrived');
                          const res = await getTokenQueue();
                          const tokens = res?.data || [];
                          setTokenQueue(isDoctor ? tokens.filter(tk => tk.doctor_id === staffDoctorId) : tokens);
                        } catch (err) {
                          alert(err.response?.data?.error || 'Failed to mark arrived');
                        } finally { setLoadingToken(null); }
                      }}
                      className="px-3 py-1 text-xs font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-50 transition"
                    >{loadingToken === t.id ? '...' : 'Arrived'}</button>
                  )}
                  {t.status === 'arrived' && (
                    <button
                      disabled={loadingToken === t.id || tokenQueue.some(tk => tk.doctor_id === t.doctor_id && tk.status === 'in_progress')}
                      onClick={async () => {
                        setLoadingToken(t.id);
                        try {
                          await updateTokenStatus(t.id, 'in_progress');
                          const res = await getTokenQueue();
                          const tokens = res?.data || [];
                          setTokenQueue(isDoctor ? tokens.filter(tk => tk.doctor_id === staffDoctorId) : tokens);
                        } catch (err) {
                          alert(err.response?.data?.error || 'Doctor already has a patient in consult');
                        } finally { setLoadingToken(null); }
                      }}
                      className="px-3 py-1 text-xs font-semibold text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition"
                    >{loadingToken === t.id ? '...' : 'Call'}</button>
                  )}
                  {t.status === 'in_progress' && (
                    <button
                      disabled={loadingToken === t.id}
                      onClick={async () => {
                        setLoadingToken(t.id);
                        try {
                          await updateTokenStatus(t.id, 'completed');
                          const res = await getTokenQueue();
                          const tokens = res?.data || [];
                          setTokenQueue(isDoctor ? tokens.filter(tk => tk.doctor_id === staffDoctorId) : tokens);
                        } catch {}
                        finally { setLoadingToken(null); }
                      }}
                      className="px-3 py-1 text-xs font-semibold text-white bg-green-500 rounded-lg hover:bg-green-600 disabled:opacity-50 transition"
                    >{loadingToken === t.id ? '...' : 'Done'}</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="px-6 py-3 border-t border-gray-100 bg-gray-50">
            <p className="text-sm text-gray-500">Showing {filteredTokens.length} of {tokenQueue.length} tokens today</p>
          </div>
        </div>

        {/* Right — Active Chats */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex flex-col self-start">
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
                to={`/conversations?id=${c.id}`}
                className="flex items-start gap-3 p-4 hover:bg-gray-50 transition"
              >
                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-indigo-700">
                    {(c.customer_name || c.customer_phone || '?')[0].toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center">
                    <p className="text-sm font-semibold text-gray-900 truncate">{c.customer_name || c.customer_phone}</p>
                    <p className="text-xs text-gray-400 flex-shrink-0 ml-2">
                      {new Date(c.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{c.last_message || 'New conversation'}</p>
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
      {!isDoctor && (
        <div className="px-6 pb-6 mt-4">
          <div className="flex justify-between items-center mb-4">
            <span className="font-bold text-gray-900 text-lg">Doctor Availability</span>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {doctors.length === 0 ? (
              <p className="text-sm text-gray-500">No doctors added yet</p>
            ) : doctors.map(d => (
              <div key={d.id} className="min-w-[160px] bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex-shrink-0">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm mb-3 ${d.available_now && !d.leave_days ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                  {(d.name || '?').split(' ').filter(w => w.toLowerCase() !== 'dr.' && w.toLowerCase() !== 'dr')[0]?.[0]?.toUpperCase() || '?'}
                </div>
                <p className="font-semibold text-sm text-gray-900 truncate">{d.name}</p>
                <p className="text-xs text-gray-500 truncate mb-2">{d.specialization}</p>
                {d.available_now && !d.leave_days ? (
                  <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
                    Available
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-gray-400 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block"></span>
                    Off Duty
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
      )}

    </div>
  );
};

export default Dashboard;
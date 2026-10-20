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
    const interval = setInterval(fetchDashboardData, 30000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchDashboardData();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
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
      } else {
        addToast('Failed to load dashboard data', 'error');
      }
      setIsOffline(true);
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

  const now = new Date();
  const dateLabel = `${now.toLocaleDateString('en-IN', { weekday: 'short' })} · ${now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`;

  const cardBase = 'bg-white rounded-2xl border border-ink/[0.08] shadow-card';
  const monoLabel = 'font-mono text-[11px] tracking-[0.08em] uppercase';
  const filterTabs = [
    { key: 'all', label: 'All' },
    { key: 'arrived', label: 'Waiting' },
    { key: 'in_consult', label: 'In Consult' },
    { key: 'done', label: 'Done' },
  ];
  const queueGrid = 'grid grid-cols-[56px_minmax(0,1fr)_auto] md:grid-cols-[64px_minmax(0,1.3fr)_minmax(0,1fr)_96px_110px] items-center gap-3';

  return (
    <div className="min-h-screen bg-bg text-ink flex flex-col gap-0">

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
      <div className="border-b border-ink/[0.08] px-6 py-5 flex justify-between items-end gap-4">
        <div className="min-w-0">
          <p className={`${monoLabel} text-ink/50`}>{dateLabel}</p>
          <h1 className="mt-1.5 text-[26px] md:text-[32px] font-semibold tracking-[-0.035em] leading-tight md:truncate">
            {isDoctor ? 'My Queue' : (tenant?.name || staff?.tenantName || 'Dashboard')}
          </h1>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <Link
            to="/bookings"
            className="px-4 py-2 text-sm font-medium bg-brand text-white rounded-lg hover:bg-brand-hover transition"
          >
            + New Token
          </Link>
        </div>
      </div>

      {/* Section 2 — Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-5">
        <div className={`${cardBase} p-5`}>
          <p className={`${monoLabel} text-ink/50`}>Today's Tokens</p>
          <p className="mt-3 text-[40px] font-semibold tracking-[-0.04em] leading-none">{stats.bookingsToday}</p>
        </div>
        <div className="bg-accent-soft text-accent rounded-2xl border border-accent/15 shadow-card p-5">
          <p className={`${monoLabel} text-accent/70`}>Waiting Now</p>
          <p className="mt-3 text-[40px] font-semibold tracking-[-0.04em] leading-none">{stats.pendingTokens}</p>
        </div>
        {!isDoctor && (
          <div className={`${cardBase} p-5`}>
            <p className={`${monoLabel} text-ink/50`}>Doctors on Duty</p>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="text-[40px] font-semibold tracking-[-0.04em] leading-none">{doctors.filter(d => d.available_now && !d.leave_days).length}</span>
              <span className="text-xl text-ink/35 font-medium">/ {doctors.length}</span>
            </div>
          </div>
        )}
        <div className={`${cardBase} p-5`}>
          <p className={`${monoLabel} text-ink/50`}>Active Chats</p>
          <p className="mt-3 text-[40px] font-semibold tracking-[-0.04em] leading-none">{stats.activeConversations}</p>
        </div>
      </div>

      {/* Section 3 — Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 px-6">

        {/* Left — Live Token Queue */}
        <div className={`lg:col-span-2 ${cardBase} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-ink/[0.08] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-semibold tracking-tight">Live Token Queue</span>
            </div>
            <span className="font-mono text-xs font-medium px-2 py-0.5 rounded-full bg-ink/[0.06] text-ink/70">
              {tokenQueue.length}
            </span>
          </div>

          <div className="px-4 py-3 flex flex-wrap gap-1.5 border-b border-ink/[0.08]">
            {filterTabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveFilter(tab.key)}
                className={`text-[13px] font-medium transition rounded-full px-3.5 py-1.5 ${
                  activeFilter === tab.key
                    ? 'bg-accent text-white'
                    : 'text-ink/55 hover:text-ink hover:bg-ink/[0.05]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {filteredTokens.length > 0 && (
            <div className={`${queueGrid} px-4 md:px-6 py-2.5 border-b border-ink/[0.08] bg-ink/[0.02] ${monoLabel} text-[10px] text-ink/45`}>
              <span>Token</span>
              <span>Patient</span>
              <span className="hidden md:block">Doctor</span>
              <span className="hidden md:block">Status</span>
              <span className="text-right">Action</span>
            </div>
          )}

          <div className="divide-y divide-ink/[0.08] max-h-[480px] overflow-y-auto">
            {filteredTokens.length === 0 ? (
              <div className="p-12 text-center text-sm text-ink/55">No tokens in queue</div>
            ) : filteredTokens.map(t => (
              <div key={t.id} className={`${queueGrid} px-4 md:px-6 py-3.5 hover:bg-ink/[0.02] transition`}>
                <span className="inline-flex items-center justify-center h-8 px-2 rounded-md bg-ink/[0.05] font-mono text-[12px] font-semibold">
                  {t.doctor_name ? t.doctor_name.replace(/^Dr\.\s*/i, '').charAt(0) : '?'}-{t.token_number}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{t.patient_name || 'Walk-in'}</p>
                  <p className="md:hidden text-xs text-ink/55 truncate">{t.doctor_name}</p>
                  <div className="md:hidden mt-1.5">{getStatusPill(t.status)}</div>
                </div>
                <p className="hidden md:block text-sm text-ink/60 truncate">{t.doctor_name}</p>
                <div className="hidden md:block">{getStatusPill(t.status)}</div>
                <div className="flex items-center justify-end gap-2 md:min-w-[100px]">
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
                    >{loadingToken === t.id ? '...' : 'Mark arrived'}</button>
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
                    >{loadingToken === t.id ? '...' : 'Call in'}</button>
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
                    >{loadingToken === t.id ? '...' : 'Finish'}</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="px-6 py-3 border-t border-ink/[0.08] bg-ink/[0.02]">
            <p className="text-sm text-ink/55">Showing {filteredTokens.length} of {tokenQueue.length} tokens today</p>
          </div>
        </div>

        {/* Right — Active Chats */}
        <div className={`${cardBase} overflow-hidden flex flex-col self-start`}>
          <div className="px-5 py-4 border-b border-ink/[0.08] flex items-center justify-between flex-shrink-0">
            <span className="font-semibold tracking-tight">Active Chats</span>
            <span className="font-mono text-xs font-medium px-2 py-0.5 rounded-full bg-ink/[0.06] text-ink/70">
              {stats.activeConversations}
            </span>
          </div>

          <div className="divide-y divide-ink/[0.08] overflow-y-auto flex-1" style={{ maxHeight: '480px' }}>
            {recentConversations.length === 0 ? (
              <p className="p-6 text-sm text-ink/55 text-center">No active chats</p>
            ) : recentConversations.map(c => (
              <Link
                key={c.id}
                to={`/conversations?id=${c.id}`}
                className="flex items-start gap-3 p-4 hover:bg-ink/[0.02] transition"
              >
                <div className="w-8 h-8 rounded-full bg-ink/[0.06] flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-semibold">
                    {(c.customer_name || c.customer_phone || '?')[0].toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center">
                    <p className="text-sm font-semibold truncate">{c.customer_name || c.customer_phone}</p>
                    <p className="font-mono text-[11px] text-ink/40 flex-shrink-0 ml-2">
                      {new Date(c.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <p className="text-xs text-ink/55 truncate mt-0.5">{c.last_message || 'New conversation'}</p>
                  {c.mode === 'human' && (
                    <span className="inline-block mt-1.5 px-1.5 py-0.5 rounded bg-accent-soft text-accent font-mono text-[11px] font-medium tracking-[0.04em]">
                      <span className="text-orange-400">●</span> Handoff requested
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>

          <div className="border-t border-ink/[0.08] px-5 py-3 bg-ink/[0.02] flex-shrink-0">
            <Link to="/conversations" className="text-sm font-semibold text-ink hover:text-ink/70">
              View all chats →
            </Link>
          </div>
        </div>
      </div>

      {/* Section 4 — Doctor Availability Strip */}
      {!isDoctor && (
        <div className="px-6 pb-6 mt-5">
          <div className="flex justify-between items-center mb-4">
            <span className="font-semibold tracking-tight text-lg">Doctor Availability</span>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {doctors.length === 0 ? (
              <p className="text-sm text-ink/55">No doctors added yet</p>
            ) : doctors.map(d => (
              <div key={d.id} className={`min-w-[170px] ${cardBase} p-4 flex-shrink-0`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm mb-3 ${d.available_now && !d.leave_days ? 'bg-emerald-100 text-emerald-700' : 'bg-ink/[0.06] text-ink/50'}`}>
                  {(d.name || '?').split(' ').filter(w => w.toLowerCase() !== 'dr.' && w.toLowerCase() !== 'dr')[0]?.[0]?.toUpperCase() || '?'}
                </div>
                <p className="font-semibold text-sm truncate">{d.name}</p>
                <p className="text-xs text-ink/55 truncate mb-2">{d.specialization}</p>
                {d.available_now && !d.leave_days ? (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
                    Available
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs text-ink/40 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-ink/30 inline-block"></span>
                    Off Duty
                  </span>
                )}
                <div className="flex gap-3 mt-2.5 font-mono text-[11px] text-ink/55">
                  <span>
                    Seen: {tokenQueue.filter(t => t.doctor_name === d.name && (t.status === 'done' || t.status === 'completed')).length}
                  </span>
                  <span>
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

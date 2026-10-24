import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  getBookings, getBookingStats,
  completeBooking, cancelBooking
} from '../services/booking.service';
import { getDoctors, updateTokenStatus, getDoctorSchedule } from '../services/clinic.service';
import { getClinicSettings } from '../services/settings.service';
import TokenReceipt from '../components/shared/TokenReceipt';
import BookingForm from '../components/BookingForm';
import useStore from '../store/useStore';
import { getStoredStaff } from '../services/auth.service';
import { TableRowSkeleton, StatCardSkeleton } from '../components/shared/Skeleton';
import { saveToCache, loadFromCache } from '../utils/offlineCache';

// The note of a booking under the patient name: one truncated line, a click shows the full text (and a second click folds it back).
// Nothing is shown for an empty note or the automatic "Booked via WhatsApp ..." note (the Source label already says it).
const BookingNote = ({ note }) => {
  const [expanded, setExpanded] = useState(false);
  const text = typeof note === 'string' ? note.trim() : '';
  if (!text || text.startsWith('Booked via WhatsApp')) return null;
  return (
    <button
      type="button"
      title={text}
      aria-expanded={expanded}
      onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
      className={`block max-w-[16rem] text-left text-xs text-ink/55 hover:text-ink/80 mt-0.5 ${expanded ? 'whitespace-pre-wrap break-words' : 'truncate'}`}
    >
      {text}
    </button>
  );
};

const Bookings = () => {
  const { addToast } = useStore();
  const staff = getStoredStaff();
  const [bookings, setBookings] = useState([]);
  const [stats, setStats] = useState({ total: 0, confirmed: 0, completed: 0, noshow: 0 });
  const [loading, setLoading] = useState(true);
  
  const [date, setDate] = useState(() => {
    const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    return `${istNow.getFullYear()}-${String(istNow.getMonth() + 1).padStart(2, '0')}-${String(istNow.getDate()).padStart(2, '0')}`
  });
  const [viewMode, setViewMode] = useState('today')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('');
  
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [doctorScheduleSessions, setDoctorScheduleSessions] = useState([]);
  
  const [bookingOpen, setBookingOpen] = useState(false);
  const [doctors, setDoctors] = useState([]);

  const [receiptBooking, setReceiptBooking] = useState(null);

  const [isOffline, setIsOffline] = useState(false);

  // Booking mode of the clinic: 'token' or 'appointment'. It stays 'token' for the stat card label until it has loaded;
  // the booking form waits for modeStatus 'ready' and shows a retry when it could not be loaded (no silent fallback to token).
  const [bookingMode, setBookingMode] = useState('token');
  const [modeStatus, setModeStatus] = useState('loading');
  const loadBookingMode = () => {
    setModeStatus('loading');
    getClinicSettings()
      .then(res => {
        const d = res?.data || res;
        setBookingMode(d?.booking_mode === 'appointment' ? 'appointment' : 'token');
        setModeStatus('ready');
      })
      .catch(() => setModeStatus('error'));
  };
  useEffect(() => {
    loadBookingMode();
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // 30s poll
    return () => clearInterval(interval);
  }, [date, statusFilter, viewMode]);

  const fetchData = async () => {
    try {
      const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      const tomorrowIST = new Date(istNow)
      tomorrowIST.setDate(tomorrowIST.getDate() + 1)
      const tomorrowDate = `${tomorrowIST.getFullYear()}-${String(tomorrowIST.getMonth()+1).padStart(2,'0')}-${String(tomorrowIST.getDate()).padStart(2,'0')}`
      const [bookingsRes, statsRes, docsRes] = await Promise.all([
        getBookings(viewMode === 'upcoming'
          ? { upcoming: true, status: statusFilter }
          : { date: viewMode === 'tomorrow' ? tomorrowDate : date, status: statusFilter }),
        getBookingStats().catch(() => ({ data: { total: 0, confirmed: 0, completed: 0, noshow: 0 } })),
        getDoctors().catch(() => ({ data: [] }))
      ]);
      setIsOffline(false);
      const bookingsData = {
        bookings: bookingsRes?.data?.bookings || bookingsRes?.data || [],
        stats: statsRes?.data || { total: 0, confirmed: 0, completed: 0, noshow: 0 },
        doctors: docsRes?.data || []
      };
      await saveToCache('bookings', bookingsData);
      setBookings(bookingsData.bookings);
      setStats(bookingsData.stats);
      setDoctors(bookingsData.doctors);
      setIsOffline(false);
    } catch (err) {
      // One automatic retry after 2s — covers brief auth/network hiccup on hard reload
      try {
        await new Promise(r => setTimeout(r, 2000))
        const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
        const tomorrowIST = new Date(istNow)
        tomorrowIST.setDate(tomorrowIST.getDate() + 1)
        const tomorrowDate = `${tomorrowIST.getFullYear()}-${String(tomorrowIST.getMonth()+1).padStart(2,'0')}-${String(tomorrowIST.getDate()).padStart(2,'0')}`
        const [bookingsRes, statsRes, docsRes] = await Promise.all([
          getBookings(viewMode === 'upcoming'
            ? { upcoming: true, status: statusFilter }
            : { date: viewMode === 'tomorrow' ? tomorrowDate : date, status: statusFilter }),
          getBookingStats().catch(() => ({ data: { total: 0, confirmed: 0, completed: 0, noshow: 0 } })),
          getDoctors().catch(() => ({ data: [] }))
        ])
        setIsOffline(false)
        const bookingsData = {
          bookings: bookingsRes?.data?.bookings || bookingsRes?.data || [],
          stats: statsRes?.data || { total: 0, confirmed: 0, completed: 0, noshow: 0 },
          doctors: docsRes?.data || []
        }
        await saveToCache('bookings', bookingsData)
        setBookings(bookingsData.bookings)
        setStats(bookingsData.stats)
        setDoctors(bookingsData.doctors)
      } catch (retryErr) {
        const cached = await loadFromCache('bookings');
        if (cached) {
          setBookings(cached.bookings);
          setStats(cached.stats);
          setDoctors(cached.doctors);
          setIsOffline(true);
        } else {
          addToast('Failed to load bookings. Please refresh the page.', 'error');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedDoctor) { setDoctorScheduleSessions([]); return; }
    const [y, m, d] = date.split('-').map(Number);
    const todayDow = new Date(y, m - 1, d).getDay();
    getDoctorSchedule(selectedDoctor.id).then(res => {
      const sessions = (res?.data || []).filter(s => s.day_of_week === todayDow && s.is_available);
      setDoctorScheduleSessions(sessions);
    }).catch(() => setDoctorScheduleSessions([]));
  }, [selectedDoctor, date]);

  const clockText = t => { const [h, m] = t.toString().split(':'); const hr = parseInt(h); return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`; };

  const toSessionMins = t => { if (!t) return null; const [h, m] = t.toString().split(':').map(Number); return h * 60 + m; };
  const fmtSessionLabel = (s, e) => { const fmt = t => { const [h, m] = t.toString().split(':'); const hr = parseInt(h); return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`; }; return `${fmt(s)} - ${fmt(e)}`; };

  const filteredBookings = bookings.filter(b => {
    const matchesDoctor = !selectedDoctor || b.doctor_name === selectedDoctor.name
    const matchesSearch = !searchQuery ||
      b.patient_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.patient_phone?.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesDoctor && matchesSearch
  })

  const sessionGroups = (selectedDoctor && doctorScheduleSessions.length > 0 && viewMode !== 'upcoming')
    ? doctorScheduleSessions.map(s => ({
        label: fmtSessionLabel(s.start_time, s.end_time),
        bookings: filteredBookings.filter(b => {
          const slotMins = toSessionMins(b.slot_time);
          return slotMins !== null && slotMins >= toSessionMins(s.start_time) && slotMins < toSessionMins(s.end_time);
        })
      }))
    : [];

  const renderBookingRow = (b) => (
    <tr key={b.id} className="hover:bg-ink/[0.03] transition-colors">
      <td className="px-6 py-4 whitespace-nowrap">
        {b.booking_type === 'procedure' ? (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700">Procedure</span>
            <span className="text-xs text-ink/65 font-medium">{b.procedure_name || 'Procedure'}</span>
            <span className="text-xs text-ink/40">{b.slot_time || '—'} — {b.end_time}</span>
          </div>
        ) : (b.token_number == null && b.slot_time) ? (
          <div className="flex flex-col items-center gap-0.5">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-ink/[0.05] text-ink/55 font-mono">Time</span>
            <span className="text-xs font-semibold text-ink">{clockText(b.slot_time)}{b.end_time ? ` – ${clockText(b.end_time)}` : ''}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-0.5">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-ink/[0.05] text-ink/55 font-mono">Token</span>
            <span className="text-sm font-mono font-semibold text-ink">{b.token_number || '-'}</span>
          </div>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm font-bold text-ink">{b.patient_name || 'Unknown'}</div>
        <div className="text-sm text-ink/55 font-medium">{b.patient_phone}</div>
        <BookingNote note={b.notes} />
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-ink/80">
        {b.doctor_name || 'Unassigned'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-ink/55 font-medium">
        {b.slot_time
          ? (() => {
              const [h, m] = b.slot_time.split(':')
              const hr = parseInt(h)
              return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`
            })()
          : new Date(b.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        }
        <span className="block text-[10px] uppercase font-bold tracking-widest text-ink/40 mt-1">{b.source}</span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span className={`px-3 py-1 inline-flex text-xs leading-5 font-bold uppercase tracking-wide rounded-full ${statusColors[b.status] || 'bg-ink/[0.05] text-ink/80'}`}>
          {b.status}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold space-x-3">
        {(b.status === 'confirmed' || b.status === 'pending') && (
          <>
            {(!b.token_id || b.token_status === 'arrived') && (
              <button onClick={() => handleAction(b.id, completeBooking)} className="text-emerald-600 hover:text-emerald-800 transition">Complete</button>
            )}
            {b.token_id && b.token_status === 'waiting' && (
              <button onClick={async () => { try { await updateTokenStatus(b.token_id, 'arrived'); fetchData(); } catch { alert('Failed to mark arrived'); } }} className="text-ink/70 hover:text-ink transition">Mark arrived</button>
            )}
            <button onClick={() => handleAction(b.id, cancelBooking)} className="text-red-500 hover:text-red-700 transition">Cancel</button>
          </>
        )}
        {(b.patient_id || b.customer_id) && (
          <Link to={`/patients/${b.patient_id || b.customer_id}`} className="text-ink hover:text-ink/70 text-sm font-medium">
            View Profile
          </Link>
        )}
      </td>
    </tr>
  );

  const handleAction = async (id, actionFn) => {
    if (actionFn === completeBooking && !window.confirm('Are you sure you want to complete this token?')) return;
    if (actionFn === cancelBooking && !window.confirm('Are you sure you want to cancel this token?')) return;
    try {
      await actionFn(id);
      fetchData();
    } catch (err) {
      alert(err?.error || err?.response?.data?.error || 'Action failed');
    }
  };

  // Opens the one booking form with a fresh doctor list (the list also says who is available right now)
  const openBookingForm = async () => {
    try { const res = await getDoctors(); if (res?.data) setDoctors(res.data); } catch {}
    setBookingOpen(true);
  };

  // After a save: close the form, refresh the list, then the token receipt or a short message
  const handleBooked = (result) => {
    setBookingOpen(false);
    fetchData();
    if (result?.kind === 'token_now') {
      if (result.booking) setReceiptBooking(result.booking);
      else addToast('Token issued', 'success');
    } else if (result?.kind === 'appointment') {
      addToast('Appointment booked', 'success');
    } else if (result?.kind === 'procedure') {
      addToast('Procedure scheduled', 'success');
    } else {
      addToast('Booking scheduled', 'success');
    }
  };

  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
    noshow: 'bg-ink/[0.05] text-ink/80'
  };

  return (
    <div className="p-4 md:p-8 space-y-6 relative">
      {isOffline && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 text-sm text-yellow-800 flex items-center gap-2">
          <span>⚠️</span>
          <span>Offline — showing cached data. New bookings cannot be created until internet is restored.</span>
        </div>
      )}
      <div className="flex flex-col md:flex-row flex-wrap justify-between items-start md:items-center gap-4">
        <div className="flex flex-wrap items-center gap-2 md:gap-4 w-full md:w-auto">
          <input
            type="date"
            value={date}
            onChange={e => { setDate(e.target.value); setViewMode('today') }}
            className={`border border-ink/[0.12] bg-white rounded-lg p-2 text-sm ${viewMode !== 'today' ? 'opacity-50' : ''}`}
          />
          <div className="flex rounded-lg border border-ink/[0.12] overflow-hidden">
            <button
              onClick={() => { setViewMode('today'); const _ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })); setDate(`${_ist.getFullYear()}-${String(_ist.getMonth()+1).padStart(2,'0')}-${String(_ist.getDate()).padStart(2,'0')}`); }}
              className={`px-3 py-2 text-sm font-medium transition ${viewMode === 'today' ? 'bg-accent text-white' : 'bg-white text-ink/65 hover:bg-ink/[0.03]'}`}
            >
              Today
            </button>
            <button
              onClick={() => { setViewMode('tomorrow'); const _ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })); _ist.setDate(_ist.getDate() + 1); setDate(`${_ist.getFullYear()}-${String(_ist.getMonth()+1).padStart(2,'0')}-${String(_ist.getDate()).padStart(2,'0')}`); }}
              className={`px-3 py-2 text-sm font-medium border-l border-ink/[0.12] transition ${viewMode === 'tomorrow' ? 'bg-accent text-white' : 'bg-white text-ink/65 hover:bg-ink/[0.03]'}`}
            >
              Tomorrow
            </button>
            <button
              onClick={() => setViewMode('upcoming')}
              className={`px-3 py-2 text-sm font-medium border-l border-ink/[0.12] transition ${viewMode === 'upcoming' ? 'bg-accent text-white' : 'bg-white text-ink/65 hover:bg-ink/[0.03]'}`}
            >
              Upcoming
            </button>
          </div>
          <input
            type="text"
            placeholder="Search patient..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="border border-ink/[0.12] bg-white rounded-lg p-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-ink/20"
          />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="border border-ink/[0.12] bg-white rounded-lg p-2 text-sm"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <div className="flex gap-2 w-full md:w-auto flex-wrap">
        <button
          onClick={openBookingForm}
          className="bg-brand text-white px-5 py-2.5 rounded-lg font-medium hover:bg-brand-hover transition flex-1 md:flex-none"
        >
          + New booking
        </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {['Total Today', bookingMode === 'appointment' ? 'Booked' : 'In Consult', 'Completed', 'Cancelled'].map((s, i) => {
          const vals = [stats.total, stats.confirmed, stats.completed, stats.cancelled];
          if (loading) return <StatCardSkeleton key={i} />
          return (
            <div key={i} className="bg-white p-5 rounded-2xl border border-ink/[0.08] shadow-card">
              <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-ink/50">{s}</p>
              <p className="text-[36px] font-semibold tracking-[-0.04em] leading-none mt-3 text-ink">{vals[i] || 0}</p>
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {staff?.role !== 'doctor' && (
          <button
            onClick={() => setSelectedDoctor(null)}
            className={selectedDoctor === null
              ? 'bg-accent text-white px-3 md:px-4 py-1.5 rounded-full text-xs md:text-[13px] font-medium whitespace-nowrap border border-accent'
              : 'bg-white text-ink/65 px-3 md:px-4 py-1.5 rounded-full text-xs md:text-[13px] font-medium border border-ink/[0.1] whitespace-nowrap hover:text-ink hover:bg-ink/[0.03]'
            }
          >
            All Doctors ({bookings.length})
          </button>
        )}

        {doctors
          .filter(doctor => staff?.role !== 'doctor' || doctor.name === staff?.name)
          .map(doctor => {
            const count = bookings.filter(b => b.doctor_name === doctor.name).length;
            return (
              <button
                key={doctor.id}
                onClick={() => setSelectedDoctor(doctor)}
                className={selectedDoctor?.id === doctor.id
                  ? 'bg-accent text-white px-3 md:px-4 py-1.5 rounded-full text-xs md:text-[13px] font-medium whitespace-nowrap border border-accent'
                  : 'bg-white text-ink/65 px-3 md:px-4 py-1.5 rounded-full text-xs md:text-[13px] font-medium border border-ink/[0.1] whitespace-nowrap hover:text-ink hover:bg-ink/[0.03]'
                }
              >
                {doctor.name} ({count})
              </button>
            )
          })}
      </div>

      <div className="bg-white rounded-2xl border border-ink/[0.08] shadow-card overflow-x-auto hidden md:block">
        <table className="min-w-[600px] w-full divide-y divide-ink/[0.08]">
          <thead className="bg-ink/[0.02]">
            <tr>
              <th className="px-6 py-3 text-left font-mono text-[10px] font-medium text-ink/45 uppercase tracking-[0.08em]">Token</th>
              <th className="px-6 py-3 text-left font-mono text-[10px] font-medium text-ink/45 uppercase tracking-[0.08em]">Patient</th>
              <th className="px-6 py-3 text-left font-mono text-[10px] font-medium text-ink/45 uppercase tracking-[0.08em]">Doctor</th>
              <th className="px-6 py-3 text-left font-mono text-[10px] font-medium text-ink/45 uppercase tracking-[0.08em]">Time/Source</th>
              <th className="px-6 py-3 text-left font-mono text-[10px] font-medium text-ink/45 uppercase tracking-[0.08em]">Status</th>
              <th className="px-6 py-3 text-right font-mono text-[10px] font-medium text-ink/45 uppercase tracking-[0.08em]">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-ink/[0.08]">
            {loading ? (
              <tr><td colSpan="6" className="p-0"><TableRowSkeleton rows={3}/></td></tr>
            ) : filteredBookings.length === 0 ? (
              <tr>
                <td colSpan="6" className="text-center py-16">
                  <div className="flex flex-col items-center justify-center space-y-3">
                    <svg className="w-12 h-12 text-ink/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                    <p className="text-ink/55 font-medium text-lg">No bookings yet today</p>
                    <button
                      onClick={openBookingForm}
                      className="mt-2 text-ink font-semibold hover:text-ink/70"
                    >
                      + New booking
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              viewMode === 'upcoming' ? (
                (() => {
                  const grouped = {}
                  filteredBookings.forEach(b => {
                    const d = new Date(b.booking_date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
                    if (!grouped[d]) grouped[d] = []
                    grouped[d].push(b)
                  })
                  return Object.entries(grouped).map(([dateLabel, dayBookings]) => (
                    <React.Fragment key={dateLabel}>
                      <tr>
                        <td colSpan="6" className="px-4 py-2 bg-ink/[0.03] font-mono text-[11px] font-medium text-ink/55 uppercase tracking-[0.08em] border-b border-ink/[0.06]">
                          {dateLabel}
                        </td>
                      </tr>
                      {dayBookings.map(b => (
                        <tr key={b.id} className="hover:bg-ink/[0.03] transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            {b.booking_type === 'procedure' ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700">Procedure</span>
                                <span className="text-xs text-ink/65 font-medium">{b.procedure_name || 'Procedure'}</span>
                                <span className="text-xs text-ink/40">{b.slot_time || '—'} – {b.end_time}</span>
                              </div>
                            ) : (b.token_number == null && b.slot_time) ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-ink/[0.05] text-ink/55 font-mono">Time</span>
                                <span className="text-xs font-semibold text-ink">{clockText(b.slot_time)}{b.end_time ? ` – ${clockText(b.end_time)}` : ''}</span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-ink/[0.05] text-ink/55 font-mono">Token</span>
                                <span className="text-sm font-mono font-semibold text-ink">{b.token_number || '-'}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-bold text-ink">{b.patient_name || 'Unknown'}</div>
                            <div className="text-sm text-ink/55 font-medium">{b.patient_phone}</div>
                            <BookingNote note={b.notes} />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-ink/80">
                            {b.doctor_name || 'Unassigned'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-ink/55 font-medium">
                            {b.slot_time
                              ? (() => {
                                  const [h, m] = b.slot_time.split(':')
                                  const hr = parseInt(h)
                                  return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`
                                })()
                              : new Date(b.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
                            }
                            <span className="block text-[10px] uppercase font-bold tracking-widest text-ink/40 mt-1">{b.source}</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-3 py-1 inline-flex text-xs leading-5 font-bold uppercase tracking-wide rounded-full ${statusColors[b.status] || 'bg-ink/[0.05] text-ink/80'}`}>
                              {b.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold space-x-3">
                            {(b.status === 'confirmed' || b.status === 'pending') && (
                              <>
                                {(!b.token_id || b.token_status === 'arrived') && (
                                  <button onClick={() => handleAction(b.id, completeBooking)} className="text-emerald-600 hover:text-emerald-800 transition">Complete</button>
                                )}
                                {b.token_id && b.token_status === 'waiting' && (
                                  <button onClick={async () => { try { await updateTokenStatus(b.token_id, 'arrived'); fetchData(); } catch { alert('Failed to mark arrived'); } }} className="text-ink/70 hover:text-ink transition">Mark arrived</button>
                                )}
                                <button onClick={() => handleAction(b.id, cancelBooking)} className="text-red-500 hover:text-red-700 transition">Cancel</button>
                              </>
                            )}
                            {(b.patient_id || b.customer_id) && (
                              <Link to={`/patients/${b.patient_id || b.customer_id}`} className="text-ink hover:text-ink/70 text-sm font-medium">
                                View Profile
                              </Link>
                            )}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))
                })()
              ) : sessionGroups.length > 0 ? (
                <>
                  {sessionGroups.map((g, gi) => (
                    <React.Fragment key={gi}>
                      <tr>
                        <td colSpan="6" className="px-4 py-2 bg-ink/[0.03] font-mono text-[11px] font-medium text-ink/55 uppercase tracking-[0.08em] border-b border-ink/[0.06]">
                          Session {gi + 1} — {g.label}
                        </td>
                      </tr>
                      {g.bookings.map(b => renderBookingRow(b))}
                    </React.Fragment>
                  ))}
                  {(() => {
                    const slottedIds = new Set(sessionGroups.flatMap(g => g.bookings.map(b => b.id)));
                    const walkins = filteredBookings.filter(b => !slottedIds.has(b.id));
                    return walkins.length > 0 ? (
                      <React.Fragment key="walkins">
                        <tr>
                          <td colSpan="6" className="px-4 py-2 bg-orange-50 font-mono text-[11px] font-medium text-orange-600 uppercase tracking-[0.08em] border-b border-orange-100">
                            Walk-ins / Unscheduled
                          </td>
                        </tr>
                        {walkins.map(b => renderBookingRow(b))}
                      </React.Fragment>
                    ) : null;
                  })()}
                </>
              ) : filteredBookings.map(b => renderBookingRow(b))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile booking list */}
      <div className="block md:hidden bg-white rounded-2xl border border-ink/[0.08] shadow-card divide-y divide-ink/[0.08] overflow-hidden">
        {filteredBookings.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-ink/40">No bookings found.</div>
        ) : (
          filteredBookings.map(b => (
            <div key={b.id} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 text-center">
                  {b.booking_type === 'procedure' ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700">Proc</span>
                  ) : (b.token_number == null && b.slot_time) ? (
                    <div className="flex flex-col items-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-ink/[0.05] text-ink/55 font-mono">Time</span>
                      <span className="text-xs font-semibold text-ink">{clockText(b.slot_time)}{b.end_time ? ` – ${clockText(b.end_time)}` : ''}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-ink/[0.05] text-ink/55 font-mono">Token</span>
                      <span className="text-sm font-mono font-semibold text-ink">{b.token_number || '-'}</span>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-ink text-sm truncate">{b.patient_name || 'Unknown'}</span>
                    <span className={`px-2 py-0.5 text-xs font-bold uppercase rounded-full flex-shrink-0 ${statusColors[b.status] || 'bg-ink/[0.05] text-ink/80'}`}>
                      {b.status}
                    </span>
                  </div>
                  <div className="text-xs text-ink/55 mt-0.5">{b.patient_phone}</div>
                  <BookingNote note={b.notes} />
                  <div className="mt-0.5 text-xs text-ink/40 truncate">{b.doctor_name}</div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-ink/40">
                    <span className="whitespace-nowrap">
                      {b.slot_time ? (() => {
                        const [h, m] = b.slot_time.split(':');
                        const hr = parseInt(h);
                        return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
                      })() : new Date(b.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                    <span>·</span>
                    <span className="uppercase font-semibold">{b.source}</span>
                  </div>
                </div>
              </div>
              {(b.status === 'confirmed' || b.status === 'pending') && (
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-ink/[0.06]">
                  {(!b.token_id || b.token_status === 'arrived') && (
                    <button onClick={() => handleAction(b.id, completeBooking)} className="flex-1 py-2 text-xs font-bold text-emerald-600 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition">Complete</button>
                  )}
                  {b.token_id && b.token_status === 'waiting' && (
                    <button onClick={async () => { try { await updateTokenStatus(b.token_id, 'arrived'); fetchData(); } catch { alert('Failed'); } }} className="flex-1 py-2 text-xs font-bold text-ink/80 border border-ink/[0.12] rounded-lg hover:bg-ink/[0.04] transition">Mark arrived</button>
                  )}
                  <button onClick={() => handleAction(b.id, cancelBooking)} className="flex-1 py-2 text-xs font-bold text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition">Cancel</button>
                  {(b.patient_id || b.customer_id) && (
                    <Link to={`/patients/${b.patient_id || b.customer_id}`} className="flex-1 py-2 text-xs font-bold text-ink/80 border border-ink/[0.12] rounded-lg hover:bg-ink/[0.04] transition text-center">Profile</Link>
                  )}
                </div>
              )}
              {b.status !== 'confirmed' && b.status !== 'pending' && (b.patient_id || b.customer_id) && (
                <div className="mt-2 pt-2 border-t border-ink/[0.06]">
                  <Link to={`/patients/${b.patient_id || b.customer_id}`} className="text-xs font-semibold text-ink hover:text-ink/70">View Profile →</Link>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <BookingForm
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        onBooked={handleBooked}
        bookingMode={bookingMode}
        modeStatus={modeStatus}
        onRetryMode={loadBookingMode}
        doctors={doctors}
        staffRole={staff?.role}
        ownDoctorId={staff?.doctor_id}
      />

      {receiptBooking && (
         <TokenReceipt booking={receiptBooking} onClose={() => setReceiptBooking(null)} />
      )}
    </div>
  );
};

export default Bookings;

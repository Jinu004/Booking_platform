import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  getBookings, getBookingStats, 
  completeBooking, cancelBooking, markNoShow, createBooking 
} from '../services/booking.service';
import { getDoctors, updateTokenStatus, getDoctorSchedule } from '../services/clinic.service';
import api from '../utils/api';
import TokenReceipt from '../components/shared/TokenReceipt';
import useStore from '../store/useStore';
import { getStoredStaff } from '../services/auth.service';
import { TableRowSkeleton, StatCardSkeleton } from '../components/shared/Skeleton';
import { saveToCache, loadFromCache } from '../utils/offlineCache';

const Bookings = () => {
  const { addToast } = useStore();
  const staff = getStoredStaff();
  const [bookings, setBookings] = useState([]);
  const [stats, setStats] = useState({ total: 0, confirmed: 0, completed: 0, noshow: 0 });
  const [loading, setLoading] = useState(true);
  
  const [date, setDate] = useState(new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).toISOString().split('T')[0]);
  const [viewMode, setViewMode] = useState('today')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('');
  
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [doctorScheduleSessions, setDoctorScheduleSessions] = useState([]);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [scheduleBooking, setScheduleBooking] = useState({ patientName: '', patientPhone: '', doctorId: '', bookingDate: '', sessionTime: '', notes: '', sendWhatsapp: true });
  const [doctorSessions, setDoctorSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [noSessions, setNoSessions] = useState(false);
  const [isScheduleSubmitting, setIsScheduleSubmitting] = useState(false);
  const [phoneSuggestions, setPhoneSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionModal, setActiveSuggestionModal] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [modalDoctors, setModalDoctors] = useState([]);
  
  const [newBooking, setNewBooking] = useState({
    patientName: '',
    patientPhone: '',
    doctorId: '',
    notes: '',
    isPresent: true,
    sendWhatsapp: true
  });

  const [receiptBooking, setReceiptBooking] = useState(null);

  const [isOffline, setIsOffline] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

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
      const tomorrowDate = tomorrowIST.toISOString().split('T')[0]
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
        const tomorrowDate = tomorrowIST.toISOString().split('T')[0]
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
    const todayDow = new Date(date + 'T00:00:00').getDay();
    getDoctorSchedule(selectedDoctor.id).then(res => {
      const sessions = (res?.data || []).filter(s => s.day_of_week === todayDow && s.is_available);
      setDoctorScheduleSessions(sessions);
    }).catch(() => setDoctorScheduleSessions([]));
  }, [selectedDoctor]);

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
    <tr key={b.id} className="hover:bg-gray-50 transition-colors">
      <td className="px-6 py-4 whitespace-nowrap">
        {b.booking_type === 'procedure' ? (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700">Procedure</span>
            <span className="text-xs text-gray-600 font-medium">{b.procedure_name || 'Procedure'}</span>
            <span className="text-xs text-gray-400">{b.slot_time} — {b.end_time}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-0.5">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-teal-100 text-teal-700">Token</span>
            <span className="text-sm font-black text-teal-700">{b.token_number || '-'}</span>
          </div>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm font-bold text-gray-900">{b.patient_name || 'Unknown'}</div>
        <div className="text-sm text-gray-500 font-medium">{b.patient_phone}</div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">
        {b.doctor_name || 'Unassigned'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-medium">
        {b.slot_time
          ? (() => {
              const [h, m] = b.slot_time.split(':')
              const hr = parseInt(h)
              return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`
            })()
          : new Date(b.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        }
        <span className="block text-[10px] uppercase font-bold tracking-widest text-gray-400 mt-1">{b.source}</span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span className={`px-3 py-1 inline-flex text-xs leading-5 font-bold uppercase tracking-wide rounded-full ${statusColors[b.status] || 'bg-gray-100 text-gray-800'}`}>
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
              <button onClick={async () => { try { await updateTokenStatus(b.token_id, 'arrived'); fetchData(); } catch { alert('Failed to mark arrived'); } }} className="text-blue-500 hover:text-blue-700 transition">Arrived</button>
            )}
            <button onClick={() => handleAction(b.id, cancelBooking)} className="text-red-500 hover:text-red-700 transition">Cancel</button>
          </>
        )}
        {(b.patient_id || b.customer_id) && (
          <Link to={`/patients/${b.patient_id || b.customer_id}`} className="text-blue-600 hover:text-blue-900 text-sm font-medium">
            View Profile
          </Link>
        )}
      </td>
    </tr>
  );

  const loadFormDependencies = async () => {
    try {
      const docRes = await getDoctors(true).catch(() => ({ data: [] }));
      setModalDoctors(docRes.data || []);
    } catch(err) {
      addToast('Failed to load form data', 'error');
    }
  };

  const handleAction = async (id, actionFn) => {
    if (actionFn === completeBooking && !window.confirm('Are you sure you want to complete this token?')) return;
    if (actionFn === cancelBooking && !window.confirm('Are you sure you want to cancel this token?')) return;
    try {
      await actionFn(id);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Action failed');
    }
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const { data } = await api.post('/bookings/manual', newBooking);
      setReceiptBooking(data.data);
      setIsModalOpen(false);
      setNewBooking({ patientName: '', patientPhone: '', doctorId: '', notes: '', isPresent: true, sendWhatsapp: true });
      fetchData();
    } catch (err) {
      alert(err?.error || err?.message || 'Failed to create booking');
    } finally {
      setIsSubmitting(false);
    }
  };

  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
    noshow: 'bg-gray-100 text-gray-800'
  };

  return (
    <div className="p-8 space-y-6 relative">
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
            className={`border-gray-300 rounded-md shadow-sm p-2 ${viewMode !== 'today' ? 'opacity-50' : ''}`}
          />
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            <button
              onClick={() => { setViewMode('today'); setDate(new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).toISOString().split('T')[0]); }}
              className={`px-3 py-2 text-sm font-medium transition ${viewMode === 'today' ? 'bg-teal-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              Today
            </button>
            <button
              onClick={() => { setViewMode('tomorrow'); setDate(new Date(new Date().setDate(new Date().getDate() + 1)).toISOString().split('T')[0]) }}
              className={`px-3 py-2 text-sm font-medium border-l border-gray-300 transition ${viewMode === 'tomorrow' ? 'bg-teal-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              Tomorrow
            </button>
            <button
              onClick={() => setViewMode('upcoming')}
              className={`px-3 py-2 text-sm font-medium border-l border-gray-300 transition ${viewMode === 'upcoming' ? 'bg-teal-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              Upcoming
            </button>
          </div>
          <input
            type="text"
            placeholder="Search patient..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="border border-gray-300 rounded-md shadow-sm p-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="border-gray-300 rounded-md shadow-sm p-2"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <button
          onClick={async () => {
            setScheduleBooking({ patientName: '', patientPhone: '', doctorId: '', bookingDate: '', sessionTime: '', notes: '', sendWhatsapp: true });
            setDoctorSessions([]);
            setNoSessions(false);
            try { const res = await getDoctors(); if (res?.data) setDoctors(res.data); } catch {}
            setIsScheduleModalOpen(true);
          }}
          className="bg-teal-600 text-white px-5 py-2.5 rounded-lg font-bold hover:bg-teal-700 transition"
        >
          + Schedule Booking
        </button>
        <button
          onClick={() => {
            loadFormDependencies();
            setIsModalOpen(true);
          }}
          className="bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition transform hover:scale-105"
        >
          + New Booking
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {['Total Today', 'In Consult', 'Completed', 'Cancelled'].map((s, i) => {
          const vals = [stats.total, stats.confirmed, stats.completed, stats.cancelled];
          if (loading) return <StatCardSkeleton key={i} />
          return (
            <div key={i} className="bg-white p-4 rounded-lg shadow border border-gray-200 hover:border-indigo-200 transition-colors">
              <p className="text-sm text-gray-500 font-medium">{s}</p>
              <p className="text-3xl font-black mt-2 text-gray-900">{vals[i] || 0}</p>
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {staff?.role !== 'doctor' && (
          <button
            onClick={() => setSelectedDoctor(null)}
            className={selectedDoctor === null
              ? 'bg-blue-600 text-white px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium whitespace-nowrap shadow-sm shadow-blue-200'
              : 'bg-white text-gray-600 px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium border whitespace-nowrap hover:bg-gray-50'
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
                  ? 'bg-blue-600 text-white px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium whitespace-nowrap shadow-sm shadow-blue-200'
                  : 'bg-white text-gray-600 px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium border whitespace-nowrap hover:bg-gray-50'
                }
              >
                {doctor.name} ({count})
              </button>
            )
          })}
      </div>

      <div className="bg-white shadow overflow-x-auto -mx-4 px-4 sm:rounded-lg">
        <table className="min-w-[600px] w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Token</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Patient</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Doctor</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Time/Source</th>
              <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan="6" className="p-0"><TableRowSkeleton rows={3}/></td></tr>
            ) : filteredBookings.length === 0 ? (
              <tr>
                <td colSpan="6" className="text-center py-16">
                  <div className="flex flex-col items-center justify-center space-y-3">
                    <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                    <p className="text-gray-500 font-medium text-lg">No bookings yet today</p>
                    <button 
                      onClick={() => {
                        loadFormDependencies();
                        setIsModalOpen(true);
                      }}
                      className="mt-2 text-indigo-600 font-bold hover:text-indigo-800"
                    >
                      + New Booking
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
                        <td colSpan="6" className="px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                          {dateLabel}
                        </td>
                      </tr>
                      {dayBookings.map(b => (
                        <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            {b.booking_type === 'procedure' ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700">Procedure</span>
                                <span className="text-xs text-gray-600 font-medium">{b.procedure_name || 'Procedure'}</span>
                                <span className="text-xs text-gray-400">{b.slot_time} – {b.end_time}</span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-teal-100 text-teal-700">Token</span>
                                <span className="text-sm font-black text-teal-700">{b.token_number || '-'}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-bold text-gray-900">{b.patient_name || 'Unknown'}</div>
                            <div className="text-sm text-gray-500 font-medium">{b.patient_phone}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">
                            {b.doctor_name || 'Unassigned'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-medium">
                            {b.slot_time
                              ? (() => {
                                  const [h, m] = b.slot_time.split(':')
                                  const hr = parseInt(h)
                                  return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`
                                })()
                              : new Date(b.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
                            }
                            <span className="block text-[10px] uppercase font-bold tracking-widest text-gray-400 mt-1">{b.source}</span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-3 py-1 inline-flex text-xs leading-5 font-bold uppercase tracking-wide rounded-full ${statusColors[b.status] || 'bg-gray-100 text-gray-800'}`}>
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
                                  <button onClick={async () => { try { await updateTokenStatus(b.token_id, 'arrived'); fetchData(); } catch { alert('Failed to mark arrived'); } }} className="text-blue-500 hover:text-blue-700 transition">Arrived</button>
                                )}
                                <button onClick={() => handleAction(b.id, cancelBooking)} className="text-red-500 hover:text-red-700 transition">Cancel</button>
                              </>
                            )}
                            {(b.patient_id || b.customer_id) && (
                              <Link to={`/patients/${b.patient_id || b.customer_id}`} className="text-blue-600 hover:text-blue-900 text-sm font-medium">
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
                        <td colSpan="6" className="px-4 py-2 bg-indigo-50 text-xs font-semibold text-indigo-600 uppercase tracking-wider border-b border-indigo-100">
                          Session {gi + 1} — {g.label}
                        </td>
                      </tr>
                      {g.bookings.map(b => renderBookingRow(b))}
                    </React.Fragment>
                  ))}
                </>
              ) : filteredBookings.map(b => renderBookingRow(b))
            )}
          </tbody>
        </table>
      </div>

      {isScheduleModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-xl font-bold text-gray-900">Schedule Booking</h2>
              <button onClick={() => setIsScheduleModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-2xl font-bold">×</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Patient Phone <span className="text-red-500">*</span></label>
                <div className="flex relative">
                  <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm font-bold">+91</span>
                  <input type="tel" required value={scheduleBooking.patientPhone}
                    onChange={async e => {
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                      setScheduleBooking({...scheduleBooking, patientPhone: digits});
                      if (digits.length === 10) {
                        try {
                          const res = await api.get(`/bookings/lookup?phone=${digits}`);
                          const found = res?.data?.patients || [];
                          if (found.length > 0) { setPhoneSuggestions(found); setShowSuggestions(true); setActiveSuggestionModal('schedule'); }
                          else { setShowSuggestions(false); }
                        } catch { setShowSuggestions(false); }
                      } else { setShowSuggestions(false); }
                    }}
                    className="flex-1 rounded-none rounded-r-md border border-gray-300 p-2 font-bold focus:ring-teal-500 focus:border-teal-500"
                    placeholder="9876543210" />
                </div>
                {showSuggestions && activeSuggestionModal === 'schedule' && (
                  <div className="mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-sm">
                    {phoneSuggestions.map(p => (
                      <button key={p.id} type="button"
                        onClick={() => { setScheduleBooking({...scheduleBooking, patientName: p.name}); setShowSuggestions(false); }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-indigo-50 transition rounded-lg">
                        {p.name}{p.age ? ` (${p.age}${p.gender ? ', ' + p.gender : ''})` : ''} <span className="text-gray-400 text-xs">{p.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Patient Name</label>
                <input type="text" value={scheduleBooking.patientName}
                  onChange={e => setScheduleBooking({...scheduleBooking, patientName: e.target.value.replace(/\b\w/g, c => c.toUpperCase())})}
                  className="block w-full rounded-md border border-gray-300 p-2 bg-gray-50"
                  placeholder="Patient Name (Optional)" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Doctor <span className="text-red-500">*</span></label>
                <select required value={scheduleBooking.doctorId}
                  onChange={async e => {
                    const doctorId = e.target.value;
                    setScheduleBooking({...scheduleBooking, doctorId, sessionTime: ''});
                    setDoctorSessions([]);
                    setNoSessions(false);
                    if (doctorId && scheduleBooking.bookingDate) {
                      setSessionsLoading(true);
                      try {
                        const res = await getDoctorSchedule(doctorId);
                        const date = new Date(scheduleBooking.bookingDate + 'T00:00:00');
                        const dow = date.getDay();
                        const sessions = (res?.data || []).filter(s => s.day_of_week === dow && s.is_available);
                        setDoctorSessions(sessions);
                        setNoSessions(sessions.length === 0);
                      } catch {} finally { setSessionsLoading(false); }
                    }
                  }}
                  className="block w-full rounded-md border border-gray-300 p-2 bg-gray-50 font-bold">
                  <option value="">Select doctor</option>
                  {doctors.map(d => <option key={d.id} value={d.id}>{d.name} — {d.specialization || 'General'}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Booking Date <span className="text-red-500">*</span></label>
                <input type="date" required value={scheduleBooking.bookingDate}
                  onChange={async e => {
                    const bookingDate = e.target.value;
                    setScheduleBooking({...scheduleBooking, bookingDate, sessionTime: ''});
                    setDoctorSessions([]);
                    setNoSessions(false);
                    if (scheduleBooking.doctorId && bookingDate) {
                      setSessionsLoading(true);
                      try {
                        const res = await getDoctorSchedule(scheduleBooking.doctorId);
                        const date = new Date(bookingDate + 'T00:00:00');
                        const dow = date.getDay();
                        const sessions = (res?.data || []).filter(s => s.day_of_week === dow && s.is_available);
                        setDoctorSessions(sessions);
                        setNoSessions(sessions.length === 0);
                      } catch {} finally { setSessionsLoading(false); }
                    }
                  }}
                  className="block w-full rounded-md border border-gray-300 p-2 bg-gray-50 font-bold" />
              </div>
              {sessionsLoading && <p className="text-sm text-gray-400">Loading sessions...</p>}
              {noSessions && <p className="text-sm text-red-500 font-medium">No sessions available on this date. Please select another date.</p>}
              {doctorSessions.length > 0 && (
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Session <span className="text-red-500">*</span></label>
                  <select required value={scheduleBooking.sessionTime}
                    onChange={e => setScheduleBooking({...scheduleBooking, sessionTime: e.target.value})}
                    className="block w-full rounded-md border border-gray-300 p-2 bg-gray-50 font-bold">
                    <option value="">Select session</option>
                    {doctorSessions.map((s, i) => {
                      const fmt = t => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h > 12 ? h - 12 : h || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`; };
                      return <option key={i} value={s.start_time}>{fmt(s.start_time)} – {fmt(s.end_time)}</option>;
                    })}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Internal Notes</label>
                <textarea value={scheduleBooking.notes}
                  onChange={e => setScheduleBooking({...scheduleBooking, notes: e.target.value})}
                  className="block w-full rounded-md border border-gray-300 p-2 bg-gray-50" rows="2" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={scheduleBooking.sendWhatsapp}
                  onChange={e => setScheduleBooking({...scheduleBooking, sendWhatsapp: e.target.checked})}
                  className="w-4 h-4 rounded accent-teal-600" />
                <span className="text-sm font-medium text-gray-700">Send WhatsApp confirmation</span>
              </label>
            </div>
            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100 mt-4">
              <button type="button" onClick={() => setIsScheduleModalOpen(false)} className="px-5 py-2.5 rounded-lg text-gray-700 font-bold hover:bg-gray-100 transition">Cancel</button>
              <button
                disabled={isScheduleSubmitting || !scheduleBooking.patientPhone || !scheduleBooking.doctorId || !scheduleBooking.bookingDate || (doctorSessions.length > 0 && !scheduleBooking.sessionTime) || noSessions}
                onClick={async () => {
                  setIsScheduleSubmitting(true);
                  try {
                    const phone = '+91' + scheduleBooking.patientPhone;
                    await api.post('/bookings/manual', {
                      patientPhone: phone,
                      patientName: scheduleBooking.patientName,
                      doctorId: scheduleBooking.doctorId,
                      bookingDate: scheduleBooking.bookingDate,
                      slot_time: scheduleBooking.sessionTime || null,
                      notes: scheduleBooking.notes,
                      isPresent: false,
                      sendWhatsapp: scheduleBooking.sendWhatsapp
                    });
                    setIsScheduleModalOpen(false);
                    setScheduleBooking({ patientName: '', patientPhone: '', doctorId: '', bookingDate: '', sessionTime: '', notes: '', sendWhatsapp: true });
                    setDoctorSessions([]);
                    setNoSessions(false);
                    fetchData();
                  } catch (err) {
                    alert(err?.error || 'Failed to schedule booking');
                  } finally {
                    setIsScheduleSubmitting(false);
                  }
                }}
                className="px-6 py-2.5 bg-teal-600 font-bold text-white rounded-lg hover:bg-teal-700 shadow-lg shadow-teal-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >{isScheduleSubmitting ? 'Scheduling...' : 'Schedule Booking'}</button>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-70 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-lg w-full transform transition-all duration-300">
            <h2 className="text-2xl font-black text-gray-900 mb-6">Issue New Token</h2>
            <form onSubmit={handleCreateSubmit} className="space-y-5">
              <div className="relative">
                <label className="block text-sm font-bold text-gray-700 mb-1">Patient Phone <span className="text-red-500">*</span></label>
                <div className="flex">
                  <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm font-bold">+91</span>
                  <input
                    type="tel" required
                    value={newBooking.patientPhone}
                    onChange={async e => {
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                      setNewBooking({...newBooking, patientPhone: digits});
                      if (digits.length === 10) {
                        try {
                          const res = await api.get(`/bookings/lookup?phone=${digits}`);
                          const found = res?.data?.patients || [];
                          if (found.length > 0) { setPhoneSuggestions(found); setShowSuggestions(true); setActiveSuggestionModal('new'); }
                          else { setShowSuggestions(false); }
                        } catch { setShowSuggestions(false); }
                      } else { setShowSuggestions(false); }
                    }}
                    className="flex-1 rounded-none rounded-r-md border border-gray-300 p-2 font-bold focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="9876543210"
                  />
                </div>
                {showSuggestions && activeSuggestionModal === 'new' && (
                  <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
                    {phoneSuggestions.map(p => (
                      <button key={p.id} type="button"
                        onClick={() => { setNewBooking({...newBooking, patientName: p.name}); setShowSuggestions(false); }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition">
                        {p.name}{p.age ? ` (${p.age}${p.gender ? ', ' + p.gender : ''})` : ''} <span className="text-gray-400 text-xs">{p.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Patient Name</label>
                <input
                  type="text"
                  value={newBooking.patientName}
                  onChange={e => setNewBooking({...newBooking, patientName: e.target.value.replace(/\b\w/g, c => c.toUpperCase())})}
                  className="block w-full rounded-md border border-gray-300 p-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="New Patient Name (Optional)"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Assign Doctor <span className="text-red-500">*</span></label>
                <select
                  required
                  value={staff?.role === 'doctor' ? staff.doctor_id : newBooking.doctorId}
                  onChange={e => staff?.role !== 'doctor' && setNewBooking(b => ({ ...b, doctorId: e.target.value }))}
                  disabled={staff?.role === 'doctor'}
                  className="block w-full rounded-md border border-gray-300 p-2 bg-gray-50 font-medium"
                >
                  <option value="">Select Doctor...</option>
                  {modalDoctors.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.specialization}) - max {d.max_tokens_daily} tokens</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Internal Notes</label>
                <textarea 
                  value={newBooking.notes}
                  onChange={e => setNewBooking({...newBooking, notes: e.target.value})}
                  className="block w-full rounded-md border border-gray-300 p-2 bg-gray-50"
                  rows="2"
                />
              </div>

              <div className="flex flex-col gap-2 mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={newBooking.isPresent} onChange={e => setNewBooking({...newBooking, isPresent: e.target.checked})} className="w-4 h-4 rounded accent-teal-600" />
                  <span className="text-sm font-medium text-gray-700">Patient is here now</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={newBooking.sendWhatsapp} onChange={e => setNewBooking({...newBooking, sendWhatsapp: e.target.checked})} className="w-4 h-4 rounded accent-teal-600" />
                  <span className="text-sm font-medium text-gray-700">Send WhatsApp confirmation</span>
                </label>
              </div>
              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 rounded-lg text-gray-700 font-bold hover:bg-gray-100 transition">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-6 py-2.5 bg-indigo-600 font-bold text-white rounded-lg hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100">
                  {isSubmitting ? 'Issuing...' : 'Issue Token'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {receiptBooking && (
         <TokenReceipt booking={receiptBooking} onClose={() => setReceiptBooking(null)} />
      )}
    </div>
  );
};

export default Bookings;

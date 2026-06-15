import React, { useState, useEffect, useRef } from 'react';
import { getDoctors, createDoctor, updateDoctor, deleteDoctor, updateAvailability, addLeave, getTokenQueue, updateTokenStatus, getDoctorSchedule, saveDoctorSchedule } from '../services/clinic.service';
import useStore from '../store/useStore';
import { CardSkeleton } from '../components/shared/Skeleton';

const AVATAR_COLORS = [
  'bg-teal-100 text-teal-700',
  'bg-indigo-100 text-indigo-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700',
  'bg-blue-100 text-blue-700',
  'bg-orange-100 text-orange-700',
];

function avatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function docInitials(name) {
  if (!name) return '?';
  const parts = name.replace(/^Dr\.?\s*/i, '').trim().split(' ').filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SPECIALIZATIONS = [
  'Ayurveda', 'Anaesthesiology', 'Cardiology',
  'Dentistry', 'Dermatology', 'ENT',
  'Endocrinology', 'Gastroenterology',
  'General Medicine', 'General Surgery',
  'Gynaecology', 'Homoeopathy', 'Nephrology',
  'Neurology', 'Oncology', 'Ophthalmology',
  'Orthopaedics', 'Paediatrics', 'Pathology',
  'Psychiatry', 'Pulmonology', 'Radiology',
  'Rheumatology', 'Urology'
];

const QUALIFICATIONS = [
  'BAMS', 'BHMS', 'BDS', 'DCH', 'DGO', 'DM',
  'DNB', 'FRCS', 'MBBS', 'MBBS MD', 'MBBS MS',
  'MBBS DNB', 'MCh', 'MD', 'MDS', 'MRCP', 'MS'
];

function SearchableSelect({
  value, onChange, options, placeholder
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value || '');
  const ref = useRef(null);

  useEffect(() => {
    setSearch(value || '');
  }, [value]);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = search.length > 0
    ? options.filter(opt => opt.toLowerCase().includes(search.toLowerCase()))
    : [];

  return (
    <div ref={ref} className="relative mt-1">
      <input
        type="text"
        value={search}
        placeholder={placeholder}
        onChange={(e) => {
          setSearch(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (search.length > 0) setOpen(true);
        }}
        className="block w-full rounded-md border-gray-300 shadow-sm p-2 bg-gray-50 focus:ring-blue-500 focus:border-blue-500 border text-sm"
      />
      {open && search.length > 0 && filtered.length > 0 && (
        <ul className="absolute z-50 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-44 overflow-y-auto">
          {filtered.map(opt => (
            <li
              key={opt}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(opt);
                setSearch(opt);
                setOpen(false);
              }}
              className="px-3 py-2 cursor-pointer hover:bg-blue-50 text-sm border-b last:border-0"
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const Doctors = () => {
  const { addToast } = useStore();
  const [doctors, setDoctors] = useState([]);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);

  const [scheduleModalDoc, setScheduleModalDoc] = useState(null);
  const [doctorSchedule, setDoctorSchedule] = useState([]);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const DAYS = [
    { key: 0, label: 'Sunday' },
    { key: 1, label: 'Monday' },
    { key: 2, label: 'Tuesday' },
    { key: 3, label: 'Wednesday' },
    { key: 4, label: 'Thursday' },
    { key: 5, label: 'Friday' },
    { key: 6, label: 'Saturday' },
  ];

  const defaultSchedule = DAYS.map(d => ({
    day_of_week: d.key,
    is_available: d.key >= 1 && d.key <= 6,
    start_time: '09:00',
    end_time: '18:00'
  }));

  // Management state
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [manageMode, setManageMode] = useState('add');
  const [manageDoctorForm, setManageDoctorForm] = useState({
    id: null, name: '', specialization: '', phone: '', qualification: '', maxTokensDaily: 30, consultationFee: ''
  });
  const [formErrors, setFormErrors] = useState({});

  const toTitleCase = (str) => str.replace(/\b\w/g, c => c.toUpperCase());

  const formatDoctorName = (value) => {
    // Remove all Dr. prefixes from start
    const cleaned = value
      .replace(/^(Dr\.?\s*)*/i, '')
      .trim();

    // If nothing left after removing Dr.
    // return empty string — let user clear field
    if (!cleaned) return '';

    // Apply title case
    const titled = cleaned.replace(
      /\b\w/g, c => c.toUpperCase()
    );

    return `Dr. ${titled}`;
  };

  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
  const [doctorToRemove, setDoctorToRemove] = useState(null);

  // Leave modal state
  const [leaveModalDoc, setLeaveModalDoc] = useState(null);
  const [leaveDays, setLeaveDays] = useState(1);
  const [leaveDate, setLeaveDate] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveType, setLeaveType] = useState('days'); // 'days' or 'date'
  const [availFilter, setAvailFilter] = useState('all');

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchQueue, 15000); // 15s poll for queue
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    setLoading(true);
    await Promise.all([fetchDoctors(), fetchQueue()]);
    setLoading(false);
  };

  const fetchDoctors = async () => {
    try {
      const result = await getDoctors();
      setDoctors(result?.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchQueue = async () => {
    try {
      const result = await getTokenQueue();
      setQueue(result?.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const openScheduleModal = async (doc) => {
    setScheduleModalDoc(doc);
    try {
      const result = await getDoctorSchedule(doc.id);
      const existing = result?.data || [];
      if (existing.length > 0) {
        const merged = DAYS.map(d => {
          const found = existing.find(s => s.day_of_week === d.key);
          return found || { day_of_week: d.key, is_available: false, start_time: '09:00', end_time: '18:00' };
        });
        setDoctorSchedule(merged);
      } else {
        setDoctorSchedule(defaultSchedule);
      }
    } catch (err) {
      setDoctorSchedule(defaultSchedule);
    }
  };

  const handleScheduleSave = async () => {
    if (!scheduleModalDoc) return;
    setSavingSchedule(true);
    try {
      await saveDoctorSchedule(scheduleModalDoc.id, doctorSchedule);
      setScheduleModalDoc(null);
      addToast('Schedule saved successfully', 'success');
    } catch (err) {
      addToast('Failed to save schedule', 'error');
    } finally {
      setSavingSchedule(false);
    }
  };

  const openAddDoctor = () => {
    setManageMode('add');
    setManageDoctorForm({ id: null, name: '', specialization: '', phone: '', qualification: '', maxTokensDaily: 30, consultationFee: '' });
    setFormErrors({});
    setIsManageModalOpen(true);
  };

  const openEditDoctor = (doc) => {
    setManageMode('edit');
    setManageDoctorForm({
      id: doc.id,
      name: doc.name,
      specialization: doc.specialization || '',
      phone: doc.phone || '',
      qualification: doc.qualification || '',
      maxTokensDaily: doc.max_tokens_daily || 30,
      consultationFee: doc.consultation_fee || ''
    });
    setFormErrors({});
    setIsManageModalOpen(true);
  };

  const handleManageSubmit = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!manageDoctorForm.name || manageDoctorForm.name.length < 2) errors.name = 'Name required (min 2 chars)';
    if (!manageDoctorForm.specialization) errors.specialization = 'Specialization required';
    if (!manageDoctorForm.qualification) errors.qualification = 'Qualification required';
    if (!manageDoctorForm.phone || manageDoctorForm.phone.length !== 10) errors.phone = 'Phone must be exactly 10 digits';
    const tokens = parseInt(manageDoctorForm.maxTokensDaily);
    if (isNaN(tokens) || tokens < 1 || tokens > 100) errors.maxTokensDaily = 'Must be a number between 1 and 100';
    const fee = parseInt(manageDoctorForm.consultationFee);
    if (isNaN(fee) || fee <= 0) errors.consultationFee = 'Fee must be greater than 0';

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});

    try {
      const payload = {
        ...manageDoctorForm,
        maxTokensDaily: parseInt(manageDoctorForm.maxTokensDaily),
        consultationFee: parseInt(manageDoctorForm.consultationFee)
      };
      if (manageMode === 'add') {
        await createDoctor(payload);
      } else {
        await updateDoctor(payload.id, payload);
      }
      setIsManageModalOpen(false);
      fetchDoctors();
    } catch (err) {
      addToast(`Failed to ${manageMode} doctor`, 'error');
    }
  };

  const handleDeleteDoctor = async (doctorId) => {
    if (!window.confirm('Are you sure you want to delete this doctor? This cannot be undone.')) return;
    try {
      await deleteDoctor(doctorId);
      fetchDoctors();
      addToast('Doctor removed successfully', 'success');
    } catch (err) {
      console.error('Delete failed:', err);
      addToast('Failed to remove doctor', 'error');
    }
  };

  const handleToggleAvailability = async (doc) => {
    if (doc.leave_days > 0) {
      // Currently on leave — clear it directly
      try {
        await updateAvailability(doc.id, { available: true, leaveDays: 0 });
        fetchDoctors();
      } catch (err) {
        addToast('Failed to update availability', 'error');
      }
    } else {
      // Not on leave — open the leave modal to register leave
      setLeaveModalDoc(doc);
    }
  };

  const handleLeaveSubmit = async (e) => {
    e.preventDefault();
    if (!leaveModalDoc) return;
    try {
      if (leaveType === 'days') {
        await updateAvailability(leaveModalDoc.id, { available: false, leaveDays });
      } else {
        await addLeave(leaveModalDoc.id, { leaveDate, reason: leaveReason });
      }
      setLeaveModalDoc(null);
      fetchDoctors();
    } catch (err) {
      addToast('Failed to register leave', 'error');
    }
  };

  const handleTokenAction = async (tokenId, status) => {
    try {
      await updateTokenStatus(tokenId, status);
      fetchQueue();
    } catch (err) {
      addToast('Failed to update token status', 'error');
    }
  };

  const tokenStatusColors = {
    waiting: 'bg-yellow-100 text-yellow-800',
    in_progress: 'bg-blue-100 text-blue-800',
    done: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800'
  };

  // Derived availability counts
  const availableCount = doctors.filter(d => d.available_now).length;
  const onLeaveCount = doctors.filter(d => d.leave_days > 0).length;
  const offDutyCount = doctors.filter(d => !d.available_now && !(d.leave_days > 0)).length;

  const filteredAvail = doctors.filter(doc => {
    if (availFilter === 'available') return doc.available_now;
    if (availFilter === 'offduty') return !doc.available_now && !(doc.leave_days > 0);
    if (availFilter === 'leave') return doc.leave_days > 0;
    return true;
  });

  const docTodayTokens = (doc) =>
    queue.filter(t => t.doctor_name === doc.name).length;

  const todayLabel = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long'
  });

  return (
    <div className="p-8 space-y-10">

      {/* ── SECTION 1: Doctor Cards ── */}
      <div>
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Doctors</h2>
            <p className="text-sm text-gray-400 mt-0.5">{doctors.length} registered</p>
          </div>
          <button
            onClick={openAddDoctor}
            className="bg-teal-600 text-white px-5 py-2.5 rounded-lg font-semibold shadow-sm hover:bg-teal-700 transition text-sm"
          >
            + Add Doctor
          </button>
        </div>

        {loading && doctors.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <CardSkeleton /><CardSkeleton /><CardSkeleton />
          </div>
        ) : doctors.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
            <p className="text-gray-400 text-sm">No doctors added yet.</p>
            <button onClick={openAddDoctor} className="mt-3 text-teal-600 font-semibold text-sm hover:text-teal-800">+ Add your first doctor</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {doctors.map(doc => (
              <div key={doc.id} className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition p-6 flex flex-col">

                {/* Avatar + name */}
                <div className="flex items-center gap-4 mb-5">
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0 ${avatarColor(doc.name)}`}>
                    {docInitials(doc.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-lg font-bold text-gray-900 truncate">{doc.name}</p>
                    <p className="text-sm text-teal-600 font-medium truncate">{doc.specialization || 'General'}</p>
                  </div>
                </div>

                {/* Info grid */}
                <div className="grid grid-cols-2 gap-3 mb-5 flex-1">
                  <div className="bg-gray-50 rounded-lg px-3 py-2.5">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Qualification</p>
                    <p className="text-sm font-semibold text-gray-700">{doc.qualification || '—'}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2.5">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Consultation</p>
                    <p className="text-sm font-semibold text-gray-700">₹{doc.consultation_fee || '—'}</p>
                  </div>
                </div>

                {/* Action icons */}
                <div className="pt-4 border-t border-gray-100 flex items-center justify-end gap-4">
                  <button
                    onClick={() => openScheduleModal(doc)}
                    title="Set Schedule"
                    className="p-2 rounded-lg text-gray-400 hover:text-teal-600 hover:bg-teal-50 transition"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => openEditDoctor(doc)}
                    title="Edit Doctor"
                    className="p-2 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDeleteDoctor(doc.id)}
                    title="Remove Doctor"
                    className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── SECTION 2: Today's Availability ── */}
      <div className="border-t border-gray-200 pt-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Today's Availability</h2>
            <p className="text-sm text-gray-400 mt-0.5">{todayLabel}</p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
              <span className="text-gray-600">{availableCount} available</span>
            </span>
            <span className="text-gray-300">·</span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-gray-400 inline-block"></span>
              <span className="text-gray-600">{offDutyCount} off duty</span>
            </span>
            <span className="text-gray-300">·</span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-400 inline-block"></span>
              <span className="text-gray-600">{onLeaveCount} on leave</span>
            </span>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 border-b border-gray-200 mb-5">
          {[
            { key: 'all', label: 'All', count: doctors.length },
            { key: 'available', label: 'Available', count: availableCount },
            { key: 'offduty', label: 'Off Duty', count: offDutyCount },
            { key: 'leave', label: 'On Leave', count: onLeaveCount },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setAvailFilter(tab.key)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${availFilter === tab.key
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              {tab.label}
              <span className={`ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full ${availFilter === tab.key ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-500'
                }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Availability cards */}
        {filteredAvail.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-sm text-gray-400">
            No doctors in this category
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {filteredAvail.map(doc => {
              const isAvailableNow = doc.available_now;
              const isOnLeave = doc.leave_days > 0;
              const isOffDuty = !isAvailableNow && !isOnLeave;
              const todayCount = docTodayTokens(doc);
              const maxTokens = doc.max_tokens_daily || 1;
              const progress = Math.min((todayCount / maxTokens) * 100, 100);

              return (
                <div key={doc.id} className={`bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-4 border-l-4 ${isAvailableNow ? 'border-l-green-500' : isOnLeave ? 'border-l-red-500' : 'border-l-gray-300'
                  }`}>

                  {/* Top: avatar + name + badge */}
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 bg-slate-100 text-slate-600">
                      {docInitials(doc.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-bold text-gray-900 truncate">{doc.name}</p>
                      <p className="text-sm text-gray-400 truncate">{doc.specialization || 'General'}</p>
                    </div>
                  </div>

                  {/* Status badge */}
                  <div>
                    {isAvailableNow && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Available
                      </span>
                    )}
                    {isOffDuty && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>Off Duty
                      </span>
                    )}
                    {isOnLeave && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>On Leave · {doc.leave_days}d left
                      </span>
                    )}
                  </div>

                  {/* Token progress */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-gray-400 font-medium">Today's tokens</span>
                      <span className="text-xs font-bold text-gray-700">{todayCount} / {maxTokens}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full bg-teal-500 transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Action button */}
                  <div className="pt-1">
                    {isOnLeave ? (
                      <button
                        onClick={() => handleToggleAvailability(doc)}
                        className="w-full py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition border border-emerald-200"
                      >
                        End Leave
                      </button>
                    ) : (
                      <button
                        onClick={() => setLeaveModalDoc(doc)}
                        className="w-full py-1.5 text-xs font-semibold rounded-lg bg-red-50 text-red-700 hover:bg-red-100 transition border border-red-200"
                      >
                        Mark on Leave
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Leave Modal */}
      {leaveModalDoc && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full">
            <h2 className="text-lg font-medium mb-4">Mark Leave for {leaveModalDoc.name}</h2>
            <form onSubmit={handleLeaveSubmit} className="space-y-4">
              <div className="flex space-x-4 mb-4">
                <label className="flex items-center">
                  <input type="radio" value="days" checked={leaveType === 'days'} onChange={() => setLeaveType('days')} className="mr-2" />
                  Leave Days
                </label>
                <label className="flex items-center">
                  <input type="radio" value="date" checked={leaveType === 'date'} onChange={() => setLeaveType('date')} className="mr-2" />
                  Specific Date
                </label>
              </div>

              {leaveType === 'days' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Number of Days</label>
                  <input
                    type="number" min="1" required
                    value={leaveDays}
                    onChange={e => setLeaveDays(parseInt(e.target.value))}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 bg-gray-50"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Leave Date</label>
                    <input
                      type="date" required
                      value={leaveDate}
                      onChange={e => setLeaveDate(e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 bg-gray-50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Reason</label>
                    <input
                      type="text"
                      value={leaveReason}
                      onChange={e => setLeaveReason(e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 bg-gray-50"
                    />
                  </div>
                </>
              )}

              <div className="flex justify-end space-x-3 mt-6">
                <button type="button" onClick={() => setLeaveModalDoc(null)} className="px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700">Confirm Leave</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Doctor Modal */}
      {isManageModalOpen && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl overflow-y-auto max-h-[90vh]">
            <h2 className="text-xl font-bold mb-4">{manageMode === 'add' ? 'Add Doctor' : 'Edit Doctor'}</h2>
            <form onSubmit={handleManageSubmit} className="space-y-4" noValidate>
              <div>
                <label className="block text-sm font-medium text-gray-700">Full Name *</label>
                <input type="text" value={manageDoctorForm.name || ''} onChange={e => setManageDoctorForm({ ...manageDoctorForm, name: formatDoctorName(e.target.value) })} className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 bg-gray-50 focus:ring-blue-500 focus:border-blue-500 border ${formErrors.name ? 'border-red-500' : ''}`} />
                {formErrors.name && <p className="mt-1 text-xs text-red-600">{formErrors.name}</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Specialization *</label>
                  <div className={`${formErrors.specialization ? 'border border-red-500 rounded-md' : ''}`}>
                    <SearchableSelect
                      value={manageDoctorForm.specialization || ''}
                      onChange={(val) => setManageDoctorForm({
                        ...manageDoctorForm, specialization: val
                      })}
                      options={SPECIALIZATIONS}
                      placeholder="Type to search e.g. General"
                    />
                  </div>
                  {formErrors.specialization && <p className="mt-1 text-xs text-red-600">{formErrors.specialization}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Phone *</label>
                  <input type="text" value={manageDoctorForm.phone} onChange={e => { const numericOnly = e.target.value.replace(/\D/g, '').slice(0, 10); setManageDoctorForm({ ...manageDoctorForm, phone: numericOnly }); }} className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 bg-gray-50 focus:ring-blue-500 focus:border-blue-500 border ${formErrors.phone ? 'border-red-500' : ''}`} />
                  {formErrors.phone && <p className="mt-1 text-xs text-red-600">{formErrors.phone}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Qualification *</label>
                  <div className={`${formErrors.qualification ? 'border border-red-500 rounded-md' : ''}`}>
                    <SearchableSelect
                      value={manageDoctorForm.qualification || ''}
                      onChange={(val) => setManageDoctorForm({
                        ...manageDoctorForm, qualification: val
                      })}
                      options={QUALIFICATIONS}
                      placeholder="Type to search e.g. MBBS"
                    />
                  </div>
                  {formErrors.qualification && <p className="mt-1 text-xs text-red-600">{formErrors.qualification}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Daily Token Limit *</label>
                  <input type="number" min="1" max="100" value={manageDoctorForm.maxTokensDaily} onChange={e => setManageDoctorForm({ ...manageDoctorForm, maxTokensDaily: e.target.value })} className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 bg-gray-50 focus:ring-blue-500 focus:border-blue-500 border ${formErrors.maxTokensDaily ? 'border-red-500' : ''}`} />
                  {formErrors.maxTokensDaily && <p className="mt-1 text-xs text-red-600">{formErrors.maxTokensDaily}</p>}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Consultation Fee *</label>
                <input type="text" placeholder="e.g. 300" value={manageDoctorForm.consultationFee} onChange={e => { const numericOnly = e.target.value.replace(/\D/g, ''); setManageDoctorForm({ ...manageDoctorForm, consultationFee: numericOnly }); }} className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 bg-gray-50 focus:ring-blue-500 focus:border-blue-500 border ${formErrors.consultationFee ? 'border-red-500' : ''}`} />
                {formErrors.consultationFee && <p className="mt-1 text-xs text-red-600">{formErrors.consultationFee}</p>}
              </div>

              <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
                <button type="button" onClick={() => setIsManageModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium">Save Details</button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* Schedule Modal */}
      {scheduleModalDoc && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full shadow-xl overflow-y-auto max-h-[90vh]">
            <h2 className="text-xl font-bold mb-2">Weekly Schedule</h2>
            <p className="text-sm text-gray-500 mb-6">{scheduleModalDoc.name}</p>

            <div className="space-y-3">
              {DAYS.map((day, idx) => {
                const s = doctorSchedule[idx];
                return (
                  <div key={day.key} className="flex items-center gap-4">
                    <label className="flex items-center gap-2 w-28">
                      <input
                        type="checkbox"
                        checked={s?.is_available || false}
                        onChange={e => {
                          const updated = [...doctorSchedule];
                          updated[idx] = { ...updated[idx], is_available: e.target.checked };
                          setDoctorSchedule(updated);
                        }}
                        className="rounded"
                      />
                      <span className="text-sm font-medium text-gray-700">{day.label}</span>
                    </label>
                    {s?.is_available && (
                      <>
                        <input
                          type="time"
                          value={s.start_time || '09:00'}
                          onChange={e => {
                            const updated = [...doctorSchedule];
                            updated[idx] = { ...updated[idx], start_time: e.target.value };
                            setDoctorSchedule(updated);
                          }}
                          className="border border-gray-300 rounded-md p-1.5 text-sm"
                        />
                        <span className="text-gray-400 text-sm">to</span>
                        <input
                          type="time"
                          value={s.end_time || '18:00'}
                          onChange={e => {
                            const updated = [...doctorSchedule];
                            updated[idx] = { ...updated[idx], end_time: e.target.value };
                            setDoctorSchedule(updated);
                          }}
                          className="border border-gray-300 rounded-md p-1.5 text-sm"
                        />
                      </>
                    )}
                    {!s?.is_available && (
                      <span className="text-sm text-gray-400 italic">Not working</span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
              <button
                onClick={() => setScheduleModalDoc(null)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleScheduleSave}
                disabled={savingSchedule}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium disabled:opacity-50"
              >
                {savingSchedule ? 'Saving...' : 'Save Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Doctors;

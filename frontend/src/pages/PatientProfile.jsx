import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getEHRPatient,
  upsertProfile,
  addCondition,
  deleteCondition,
  addVisitNote,
  updateVisitNote,
} from '../services/ehr.service';
import { getDoctors } from '../services/clinic.service';
import { getStoredStaff } from '../services/auth.service';
import useStore from '../store/useStore';
import { CardSkeleton } from '../components/shared/Skeleton';

// ── Helpers ───────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-teal-100 text-teal-700',
  'bg-indigo-100 text-indigo-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700',
];

function avatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function calcAge(dob) {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

function relativeDate(dateStr) {
  if (!dateStr) return 'Never';
  const diffDays = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 0) return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${diffDays}d ago`;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtWeekday(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-IN', { weekday: 'long' });
}

const BLOOD_COLORS = {
  'O+': 'bg-red-100 text-red-700', 'O-': 'bg-red-50 text-red-400',
  'A+': 'bg-blue-100 text-blue-700', 'A-': 'bg-blue-50 text-blue-400',
  'B+': 'bg-green-100 text-green-700', 'B-': 'bg-green-50 text-green-400',
  'AB+': 'bg-purple-100 text-purple-700', 'AB-': 'bg-purple-50 text-purple-400',
};

const BLOOD_GROUPS = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-0.5">{label}</p>
      <p className={`text-sm font-medium ${value ? 'text-gray-800' : 'text-gray-300'}`}>{value || 'Not set'}</p>
    </div>
  );
}

// ── Lock Screen ───────────────────────────────────────────────────────────────

function LockScreen() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">EHR is a Pro Feature</h2>
      <p className="text-gray-500 text-sm max-w-sm">
        EHR is available on the Pro plan. Contact{' '}
        <a href="mailto:support@receptionai.in" className="text-teal-600 hover:underline">
          support@receptionai.in
        </a>{' '}
        to upgrade.
      </p>
    </div>
  );
}

// ── Condition Section ─────────────────────────────────────────────────────────

function ConditionSection({ title, type, items, chipClass, onAdd, onDelete, saving }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const handleAdd = async () => {
    if (!name.trim()) return;
    await onAdd(type, name.trim());
    setName('');
    setAdding(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">
          {title}{' '}
          <span className="text-gray-400 font-normal">({items.length})</span>
        </h3>
        <button
          onClick={() => { setAdding(true); setName(''); }}
          className="text-xs text-teal-600 font-semibold hover:text-teal-800"
        >
          + Add
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {items.map(item => (
          <span
            key={item.id}
            className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${chipClass}`}
          >
            {item.name}
            <button
              onClick={() => onDelete(item.id)}
              className="ml-0.5 hover:opacity-60 transition font-bold leading-none"
            >
              ×
            </button>
          </span>
        ))}
        {items.length === 0 && !adding && (
          <p className="text-xs text-gray-300 italic">None recorded</p>
        )}
      </div>

      {adding && (
        <div className="flex items-center gap-2 mt-3">
          <input
            autoFocus
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder={`Enter ${title.toLowerCase()}...`}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <button
            onClick={handleAdd}
            disabled={saving || !name.trim()}
            className="px-3 py-1.5 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50"
          >
            Add
          </button>
          <button
            onClick={() => setAdding(false)}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ── Visit Note Card ───────────────────────────────────────────────────────────

function VisitNoteCard({ note, isLatest, onEdit }) {
  return (
    <div className="flex-1 bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${avatarColor(note.doctor_name)}`}>
            {initials(note.doctor_name)}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{note.doctor_name || 'Unknown Doctor'}</p>
            {note.doctor_specialization && (
              <p className="text-xs text-gray-400">{note.doctor_specialization}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isLatest && (
            <span className="px-2 py-0.5 bg-teal-50 text-teal-700 text-xs font-bold rounded-full border border-teal-100">
              Latest
            </span>
          )}
          <p className="text-xs text-gray-400">{fmtDate(note.visit_date)} · {relativeDate(note.visit_date)}</p>
          <button
            onClick={() => onEdit(note)}
            className="text-gray-300 hover:text-teal-600 transition"
            title="Edit note"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
        </div>
      </div>

      {note.diagnosis && (
        <div className="mb-3">
          <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-1">Diagnosis</p>
          <p className="text-sm text-gray-700 leading-relaxed">{note.diagnosis}</p>
        </div>
      )}
      {note.prescription && (
        <div className="mb-3">
          <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-1">Prescription</p>
          <p className="text-sm text-gray-700 leading-relaxed">{note.prescription}</p>
        </div>
      )}
      {note.follow_up_date && (
        <div className="mt-3 flex items-center gap-2 text-xs text-teal-700 bg-teal-50 rounded-lg px-3 py-2">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Follow-up: {fmtDate(note.follow_up_date)}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PatientProfile() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const { addToast } = useStore();

  const staff = getStoredStaff();
  const isPro = staff?.tenantPlan === 'pro';

  // Data state
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState(null);
  const [profile, setProfile] = useState({});
  const [conditions, setConditions] = useState([]);
  const [visitNotes, setVisitNotes] = useState([]);
  const [bookings, setBookings] = useState([]);

  // UI state
  const [activeTab, setActiveTab] = useState('overview');

  // Overview edit state
  const [editingBasic, setEditingBasic] = useState(false);
  const [basicForm, setBasicForm] = useState({});
  const [editingEmergency, setEditingEmergency] = useState(false);
  const [emergencyForm, setEmergencyForm] = useState({});
  const [savingProfile, setSavingProfile] = useState(false);

  // Condition state
  const [savingCondition, setSavingCondition] = useState(false);

  // Visit note state
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [noteForm, setNoteForm] = useState({
    visit_date: '', doctor_id: '', diagnosis: '', prescription: '', follow_up_date: '',
    _doctor_name: '', _doctor_specialization: '',
  });
  const [doctors, setDoctors] = useState([]);
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    if (!isPro) return;
    loadData();
  }, [customerId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await getEHRPatient(customerId);
      const d = res?.data || res || {};
      setCustomer(d.customer || {});
      setProfile(d.profile || {});
      setConditions(d.conditions || []);
      setVisitNotes(d.visitNotes || d.visit_notes || []);
      setBookings(d.bookings || []);
    } catch {
      addToast('Failed to load patient data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadDoctors = async () => {
    try {
      const res = await getDoctors();
      setDoctors(res?.data?.data || res?.data?.doctors || res?.data || []);
    } catch {
      addToast('Failed to load doctors', 'error');
    }
  };

  // ── Overview handlers ──────────────────────────────────────────────────────

  const startEditBasic = () => {
    setBasicForm({
      date_of_birth: profile?.date_of_birth?.split('T')[0] || '',
      gender: profile?.gender || '',
      blood_group: profile?.blood_group || '',
    });
    setEditingBasic(true);
  };

  const saveBasic = async () => {
    setSavingProfile(true);
    try {
      await upsertProfile(customerId, basicForm);
      setProfile(prev => ({ ...prev, ...basicForm }));
      setEditingBasic(false);
      addToast('Profile updated', 'success');
    } catch {
      addToast('Failed to update profile', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const startEditEmergency = () => {
    setEmergencyForm({
      emergency_contact_name: profile?.emergency_contact_name || '',
      emergency_contact_phone: profile?.emergency_contact_phone || '',
      emergency_contact_relationship: profile?.emergency_contact_relationship || '',
    });
    setEditingEmergency(true);
  };

  const saveEmergency = async () => {
    setSavingProfile(true);
    try {
      await upsertProfile(customerId, emergencyForm);
      setProfile(prev => ({ ...prev, ...emergencyForm }));
      setEditingEmergency(false);
      addToast('Emergency contact updated', 'success');
    } catch {
      addToast('Failed to update emergency contact', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  // ── Condition handlers ─────────────────────────────────────────────────────

  const handleAddCondition = async (type, name) => {
    setSavingCondition(true);
    try {
      const res = await addCondition(customerId, { type, name });
      const newItem = res?.data || { id: Date.now().toString(), type, name };
      setConditions(prev => [...prev, newItem]);
      addToast('Added successfully', 'success');
    } catch {
      addToast('Failed to add', 'error');
    } finally {
      setSavingCondition(false);
    }
  };

  const handleDeleteCondition = async (id) => {
    try {
      await deleteCondition(customerId, id);
      setConditions(prev => prev.filter(c => c.id !== id));
    } catch {
      addToast('Failed to delete', 'error');
    }
  };

  // ── Visit note handlers ────────────────────────────────────────────────────

  const openAddNote = async () => {
    const storedStaff = getStoredStaff();
    const defaultDoctorId = storedStaff?.role === 'doctor' && storedStaff?.doctor_id ? storedStaff.doctor_id : '';
    await loadDoctors();
    setEditingNote(null);
    setNoteForm({
      visit_date: new Date().toISOString().split('T')[0],
      doctor_id: defaultDoctorId, diagnosis: '', prescription: '', follow_up_date: '',
      _doctor_name: '', _doctor_specialization: '',
    });
    setShowNoteForm(true);
  };

  const openEditNote = async (note) => {
    await loadDoctors();
    setEditingNote(note);
    setNoteForm({
      visit_date: note.visit_date?.split('T')[0] || '',
      doctor_id: note.doctor_id || '',
      diagnosis: note.diagnosis || '',
      prescription: note.prescription || '',
      follow_up_date: note.follow_up_date?.split('T')[0] || '',
      _doctor_name: note.doctor_name || '',
      _doctor_specialization: note.doctor_specialization || '',
    });
    setShowNoteForm(true);
  };

  const handleSaveNote = async () => {
    const selectedDoc = doctors.find(d => d.id === noteForm.doctor_id);
    const payload = {
      visit_date: noteForm.visit_date,
      doctor_id: noteForm.doctor_id || null,
      doctor_name: selectedDoc?.name || noteForm._doctor_name || '',
      doctor_specialization: selectedDoc?.specialization || noteForm._doctor_specialization || '',
      diagnosis: noteForm.diagnosis || null,
      prescription: noteForm.prescription || null,
      follow_up_date: noteForm.follow_up_date || null,
    };

    setSavingNote(true);
    try {
      if (editingNote) {
        await updateVisitNote(customerId, editingNote.id, payload);
        addToast('Visit note updated', 'success');
      } else {
        await addVisitNote(customerId, payload);
        addToast('Visit note added', 'success');
      }
      setShowNoteForm(false);
      setEditingNote(null);
      await loadData();
    } catch {
      addToast('Failed to save visit note', 'error');
    } finally {
      setSavingNote(false);
    }
  };

  // ── Pro gate ───────────────────────────────────────────────────────────────

  if (!isPro) return <LockScreen />;

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-8 space-y-6 max-w-5xl mx-auto">
        <div className="h-5 w-28 bg-gray-200 rounded animate-pulse" />
        <CardSkeleton />
        <div className="grid grid-cols-3 gap-4">
          <CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
        <CardSkeleton />
      </div>
    );
  }

  if (!customer) {
    return <div className="p-8 text-center text-gray-500 text-sm">Patient not found.</div>;
  }

  // ── Derived data ───────────────────────────────────────────────────────────

  const age = calcAge(profile?.date_of_birth);
  const isNew = (customer.total_visits || 0) === 0;
  const bloodGroup = profile?.blood_group;

  const sortedNotes = [...visitNotes].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );

  const now = new Date();
  const nextAppt = [...bookings]
    .filter(b => (b.status === 'upcoming' || b.status === 'pending') && new Date(b.booking_date) >= now)
    .sort((a, b) => new Date(a.booking_date) - new Date(b.booking_date))[0];

  const lastNote = sortedNotes[0];

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'medical', label: 'Medical History' },
    { key: 'notes', label: 'Visit Notes' },
    { key: 'bookings', label: 'Bookings' },
  ];

  const BOOKING_STATUS_COLORS = {
    upcoming: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-700',
    pending: 'bg-gray-100 text-gray-600',
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">

      {/* Back button */}
      <button
        onClick={() => navigate('/patients')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Patients
      </button>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-5">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center text-2xl font-black flex-shrink-0 ${avatarColor(customer.name)}`}>
            {initials(customer.name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1.5">
              <h1 className="text-2xl font-bold text-gray-900">{customer.name || 'Unknown Patient'}</h1>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                isNew ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
              }`}>
                {isNew ? 'New' : 'Returning'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500 flex-wrap">
              {age && <span>{age}y</span>}
              {profile?.gender && <><span className="text-gray-300">·</span><span>{profile.gender}</span></>}
              {bloodGroup && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${BLOOD_COLORS[bloodGroup] || 'bg-gray-100 text-gray-600'}`}>
                    {bloodGroup}
                  </span>
                </>
              )}
              {customer.phone && <><span className="text-gray-300">·</span><span>{customer.phone}</span></>}
            </div>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-400 uppercase font-semibold tracking-wider mb-2">Total Visits</p>
          <p className="text-3xl font-black text-teal-600">{customer.total_visits ?? visitNotes.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-400 uppercase font-semibold tracking-wider mb-2">Last Visit</p>
          <p className="text-xl font-bold text-gray-800">{lastNote ? fmtDate(lastNote.visit_date) : '—'}</p>
          {lastNote && <p className="text-xs text-gray-400 mt-0.5">{relativeDate(lastNote.visit_date)}</p>}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-400 uppercase font-semibold tracking-wider mb-2">Next Appointment</p>
          {nextAppt ? (
            <>
              <p className="text-xl font-bold text-gray-800">{fmtDate(nextAppt.booking_date)}</p>
              <p className="text-xs text-gray-400 mt-0.5 truncate">{nextAppt.doctor_name}</p>
            </>
          ) : (
            <p className="text-sm text-gray-300 font-medium mt-1">None scheduled</p>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-6">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => { setActiveTab(t.key); if (t.key === 'notes') loadDoctors(); }}
              className={`pb-3 px-1 border-b-2 text-sm font-semibold whitespace-nowrap transition-colors ${
                activeTab === t.key
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── OVERVIEW ── */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-2 gap-6">

          {/* Basic Information */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900">Basic Information</h2>
              {!editingBasic && (
                <button onClick={startEditBasic} className="text-xs text-teal-600 font-semibold hover:text-teal-800">
                  Edit
                </button>
              )}
            </div>

            {editingBasic ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-500 font-medium mb-1">Date of Birth</label>
                  <input
                    type="date"
                    value={basicForm.date_of_birth || ''}
                    onChange={e => setBasicForm(p => ({ ...p, date_of_birth: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 font-medium mb-1">Gender</label>
                  <select
                    value={basicForm.gender || ''}
                    onChange={e => setBasicForm(p => ({ ...p, gender: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">Select gender</option>
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 font-medium mb-1">Blood Group</label>
                  <select
                    value={basicForm.blood_group || ''}
                    onChange={e => setBasicForm(p => ({ ...p, blood_group: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">Select blood group</option>
                    {BLOOD_GROUPS.map(g => <option key={g}>{g}</option>)}
                  </select>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={saveBasic}
                    disabled={savingProfile}
                    className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50"
                  >
                    {savingProfile ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => setEditingBasic(false)}
                    className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <Field label="Name" value={customer.name} />
                <Field label="Phone" value={customer.phone} />
                <Field label="Age" value={age ? `${age} years` : null} />
                <Field label="Gender" value={profile?.gender} />
                <Field label="Blood Group" value={bloodGroup} />
                <Field label="Patient Since" value={fmtDate(customer.created_at)} />
              </div>
            )}
          </div>

          {/* Emergency Contact */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900">Emergency Contact</h2>
              {!editingEmergency && (
                <button onClick={startEditEmergency} className="text-xs text-teal-600 font-semibold hover:text-teal-800">
                  Edit
                </button>
              )}
            </div>

            {editingEmergency ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-500 font-medium mb-1">Name</label>
                  <input
                    type="text"
                    value={emergencyForm.emergency_contact_name || ''}
                    onChange={e => setEmergencyForm(p => ({ ...p, emergency_contact_name: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 font-medium mb-1">Phone</label>
                  <input
                    type="text"
                    value={emergencyForm.emergency_contact_phone || ''}
                    onChange={e => setEmergencyForm(p => ({ ...p, emergency_contact_phone: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 font-medium mb-1">Relationship</label>
                  <input
                    type="text"
                    value={emergencyForm.emergency_contact_relationship || ''}
                    onChange={e => setEmergencyForm(p => ({ ...p, emergency_contact_relationship: e.target.value }))}
                    placeholder="e.g. Spouse, Parent, Sibling…"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={saveEmergency}
                    disabled={savingProfile}
                    className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50"
                  >
                    {savingProfile ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => setEditingEmergency(false)}
                    className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <Field label="Name" value={profile?.emergency_contact_name} />
                <Field label="Phone" value={profile?.emergency_contact_phone} />
                <Field label="Relationship" value={profile?.emergency_contact_relationship} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MEDICAL HISTORY ── */}
      {activeTab === 'medical' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-8">
          <ConditionSection
            title="Chronic Conditions"
            type="condition"
            items={conditions.filter(c => c.type === 'condition')}
            chipClass="bg-yellow-100 text-yellow-700"
            onAdd={handleAddCondition}
            onDelete={handleDeleteCondition}
            saving={savingCondition}
          />
          <div className="border-t border-gray-100 pt-6">
            <ConditionSection
              title="Allergies"
              type="allergy"
              items={conditions.filter(c => c.type === 'allergy')}
              chipClass="bg-red-100 text-red-700"
              onAdd={handleAddCondition}
              onDelete={handleDeleteCondition}
              saving={savingCondition}
            />
          </div>
          <div className="border-t border-gray-100 pt-6">
            <ConditionSection
              title="Current Medications"
              type="medication"
              items={conditions.filter(c => c.type === 'medication')}
              chipClass="bg-teal-100 text-teal-700"
              onAdd={handleAddCondition}
              onDelete={handleDeleteCondition}
              saving={savingCondition}
            />
          </div>
        </div>
      )}

      {/* ── VISIT NOTES ── */}
      {activeTab === 'notes' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">
              Visit history{' '}
              <span className="text-gray-400 font-normal">({sortedNotes.length})</span>
            </h2>
            <button
              onClick={openAddNote}
              className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition"
            >
              + Add Visit Note
            </button>
          </div>

          {/* Add / Edit form */}
          {showNoteForm && (
            <div className="bg-white rounded-xl border border-teal-200 p-6 shadow-sm space-y-4">
              <h3 className="font-semibold text-gray-900 text-sm">
                {editingNote ? 'Edit Visit Note' : 'New Visit Note'}
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 font-medium mb-1">Visit Date *</label>
                  <input
                    type="date"
                    value={noteForm.visit_date}
                    onChange={e => setNoteForm(p => ({ ...p, visit_date: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 font-medium mb-1">Doctor</label>
                  <select
                    value={noteForm.doctor_id}
                    onChange={e => setNoteForm(p => ({ ...p, doctor_id: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">
                      {editingNote && noteForm._doctor_name ? noteForm._doctor_name : 'Select doctor'}
                    </option>
                    {doctors.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.name}{d.specialization ? ` (${d.specialization})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 font-medium mb-1">Diagnosis</label>
                <textarea
                  rows={3}
                  value={noteForm.diagnosis}
                  onChange={e => setNoteForm(p => ({ ...p, diagnosis: e.target.value }))}
                  placeholder="Enter diagnosis…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 font-medium mb-1">Prescription</label>
                <textarea
                  rows={3}
                  value={noteForm.prescription}
                  onChange={e => setNoteForm(p => ({ ...p, prescription: e.target.value }))}
                  placeholder="Enter prescription…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div className="w-1/2">
                <label className="block text-xs text-gray-500 font-medium mb-1">Follow-up Date</label>
                <input
                  type="date"
                  value={noteForm.follow_up_date}
                  onChange={e => setNoteForm(p => ({ ...p, follow_up_date: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSaveNote}
                  disabled={savingNote || !noteForm.visit_date}
                  className="px-5 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50"
                >
                  {savingNote ? 'Saving…' : 'Save Note'}
                </button>
                <button
                  onClick={() => { setShowNoteForm(false); setEditingNote(null); }}
                  className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Timeline */}
          {sortedNotes.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
              No visit notes yet. Add the first one above.
            </div>
          ) : (
            <div className="space-y-0">
              {sortedNotes.map((note, idx) => (
                <div key={note.id} className="flex gap-4 pb-5">
                  <div className="flex flex-col items-center pt-2 flex-shrink-0">
                    <div className="w-3 h-3 rounded-full bg-teal-500 ring-2 ring-white ring-offset-1 flex-shrink-0" />
                    {idx < sortedNotes.length - 1 && (
                      <div className="flex-1 w-0.5 bg-gray-200 mt-1" />
                    )}
                  </div>
                  <VisitNoteCard
                    note={note}
                    isLatest={idx === 0}
                    onEdit={openEditNote}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── BOOKINGS ── */}
      {activeTab === 'bookings' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {bookings.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">No bookings found</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Time</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Doctor</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[...bookings]
                  .sort((a, b) => new Date(b.booking_date) - new Date(a.booking_date))
                  .map(b => (
                    <tr key={b.id} className="hover:bg-gray-50 transition">
                      <td className="px-6 py-4">
                        <p className="text-sm font-semibold text-gray-900">{fmtDate(b.booking_date)}</p>
                        <p className="text-xs text-gray-400">{fmtWeekday(b.booking_date)}</p>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{b.booking_time || '—'}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{b.doctor_name || '—'}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${
                          BOOKING_STATUS_COLORS[b.status] || BOOKING_STATUS_COLORS.pending
                        }`}>
                          {b.status || 'unknown'}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      )}

    </div>
  );
}

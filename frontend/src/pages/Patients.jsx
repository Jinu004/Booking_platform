import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getEHRPatients } from '../services/ehr.service';
import { getStoredStaff } from '../services/auth.service';
import useStore from '../store/useStore';
import { TableRowSkeleton } from '../components/shared/Skeleton';
import api from '../utils/api';

const AVATAR_COLORS = [
  'bg-indigo-100 text-indigo-700',
  'bg-teal-100 text-teal-700',
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
  return `${diffDays}d ago`;
}

const BLOOD_COLORS = {
  'O+': 'bg-red-100 text-red-700',
  'O-': 'bg-red-50 text-red-400',
  'A+': 'bg-blue-100 text-blue-700',
  'A-': 'bg-blue-50 text-blue-400',
  'B+': 'bg-green-100 text-green-700',
  'B-': 'bg-green-50 text-green-400',
  'AB+': 'bg-purple-100 text-purple-700',
  'AB-': 'bg-purple-50 text-purple-400',
};

export default function Patients() {
  const navigate = useNavigate();
  const { addToast } = useStore();
  const staff = getStoredStaff();
  const isPro = staff?.tenantPlan === 'pro';

  const [patients, setPatients] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const [showAddPatient, setShowAddPatient] = useState(false);
  const [addPatientPhone, setAddPatientPhone] = useState('');
  const [addPatientSearch, setAddPatientSearch] = useState(null); // null = not searched yet, [] = no results
  const [addPatientSearching, setAddPatientSearching] = useState(false);
  const [addPatientForm, setAddPatientForm] = useState({ name: '', age: '', gender: '', blood_group: '' });
  const [addPatientSaving, setAddPatientSaving] = useState(false);

  useEffect(() => {
    if (!isPro) return;
    const timer = setTimeout(fetchPatients, 500);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { setCurrentPage(1); }, [search, activeFilter]);

  const fetchPatients = async () => {
    try {
      setLoading(true);
      const res = await getEHRPatients(search);
      setPatients(res?.data?.customers || []);
      setTotal(res?.data?.total || 0);
    } catch {
      addToast('Failed to load patients', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchPhone = async () => {
    if (!addPatientPhone.trim()) return;
    setAddPatientSearching(true);
    try {
      const res = await api.get(`/ehr/patients?search=${addPatientPhone.trim()}`);
      setAddPatientSearch(res.data?.customers || []);
    } catch (err) {
      setAddPatientSearch([]);
    } finally {
      setAddPatientSearching(false);
    }
  };

  const handleAddPatient = async () => {
    if (!addPatientForm.name.trim() || !addPatientPhone.trim()) return;
    setAddPatientSaving(true);
    try {
      await api.post('/ehr/patients', {
        name: addPatientForm.name.trim(),
        phone: addPatientPhone.trim(),
        age: addPatientForm.age || null,
        gender: addPatientForm.gender || null,
        blood_group: addPatientForm.blood_group || null
      });
      addToast('Patient added successfully', 'success');
      setShowAddPatient(false);
      setAddPatientPhone('');
      setAddPatientSearch(null);
      setAddPatientForm({ name: '', age: '', gender: '', blood_group: '' });
      fetchPatients();
    } catch (err) {
      addToast('Failed to add patient', 'error');
    } finally {
      setAddPatientSaving(false);
    }
  };

  const handleCloseAddPatient = () => {
    setShowAddPatient(false);
    setAddPatientPhone('');
    setAddPatientSearch(null);
    setAddPatientForm({ name: '', age: '', gender: '', blood_group: '' });
  };

  if (!isPro) {
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

  const newCount = patients.filter(p => (parseInt(p.total_visits || 0)) === 0).length;
  const returningCount = patients.filter(p => (parseInt(p.total_visits || 0)) > 0).length;

  const filtered =
    activeFilter === 'new' ? patients.filter(p => (parseInt(p.total_visits || 0)) === 0)
    : activeFilter === 'returning' ? patients.filter(p => (parseInt(p.total_visits || 0)) > 0)
    : patients;

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginatedPatients = filtered.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Patients</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-sm text-gray-500">{total} total</span>
            <span className="w-1 h-1 bg-gray-300 rounded-full" />
            <span className="text-sm text-green-600 font-medium">{newCount} new</span>
            <span className="w-1 h-1 bg-gray-300 rounded-full" />
            <span className="text-sm text-blue-600 font-medium">{returningCount} returning</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAddPatient(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Patient
          </button>
          <input
            type="text"
            placeholder="Search name or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-64 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { key: 'all', label: 'All' },
          { key: 'new', label: 'New' },
          { key: 'returning', label: 'Returning' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveFilter(tab.key)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
              activeFilter === tab.key
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto hidden md:block">
        {loading ? (
          <TableRowSkeleton rows={6} />
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center text-gray-400 text-sm">No patients found</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Patient</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Blood Group</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Last Visit</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Visits</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginatedPatients.map(p => {
                const isNew = (parseInt(p.total_visits || 0)) === 0;
                const bloodGroup = p.profile?.blood_group;
                const age = calcAge(p.profile?.date_of_birth);
                const gender = p.profile?.gender;
                return (
                  <tr key={p.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${avatarColor(p.name)}`}>
                          {initials(p.name)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{p.name || '—'}</p>
                          <p className="text-xs text-gray-400">
                            {[age ? `${age}y` : null, gender].filter(Boolean).join(' · ') || 'No info'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{p.phone || '—'}</td>
                    <td className="px-6 py-4">
                      {bloodGroup ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${BLOOD_COLORS[bloodGroup] || 'bg-gray-100 text-gray-600'}`}>
                          {bloodGroup}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-sm">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{relativeDate(p.last_seen)}</td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-700">{parseInt(p.total_visits || 0)}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        isNew ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {isNew ? 'New' : 'Returning'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => navigate(`/patients/${p.id}`)}
                        className="text-sm text-teal-600 font-semibold hover:text-teal-800"
                      >
                        View Profile →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Mobile patient list */}
      <div className="block md:hidden bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {!loading && filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">No patients found.</div>
        ) : (
          filtered.map(p => {
            const isNew = parseInt(p.total_visits || 0) === 0;
            return (
              <div
                key={p.id}
                onClick={() => navigate(`/patients/${p.id}`)}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 active:bg-gray-100 cursor-pointer"
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0"
                  style={{ backgroundColor: `hsl(${(p.name?.charCodeAt(0) || 65) * 37 % 360}, 60%, 55%)` }}
                >
                  {p.name?.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 text-sm truncate">{p.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${isNew ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                      {isNew ? 'New' : 'Returning'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{p.phone}</div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                    {p.last_seen && <span>Last: {relativeDate(p.last_seen)}</span>}
                    <span>{parseInt(p.total_visits || 0)} visits</span>
                  </div>
                </div>
                <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {!loading && filtered.length > 0 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-sm text-gray-500">
            Showing{' '}
            <span className="font-medium text-gray-700">
              {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)}
            </span>{' '}
            of{' '}
            <span className="font-medium text-gray-700">{filtered.length}</span>{' '}
            patients
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => p - 1)}
              disabled={currentPage === 1}
              className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              ← Previous
            </button>
            <span className="text-sm font-medium text-gray-600 px-1">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => p + 1)}
              disabled={currentPage === totalPages}
              className="px-4 py-2 text-sm font-semibold rounded-lg border border-teal-600 bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Next →
            </button>
          </div>
        </div>
      )}
      {showAddPatient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Add Patient</h2>
              <button onClick={handleCloseAddPatient} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Step 1 — Phone search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Phone Number</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={addPatientPhone}
                    onChange={e => { setAddPatientPhone(e.target.value); setAddPatientSearch(null); }}
                    placeholder="+919876543210"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    onClick={handleSearchPhone}
                    disabled={addPatientSearching || !addPatientPhone.trim()}
                    className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50"
                  >
                    {addPatientSearching ? 'Searching...' : 'Search'}
                  </button>
                </div>
              </div>

              {/* Existing patients under this number */}
              {addPatientSearch !== null && (
                <div>
                  {addPatientSearch.length > 0 ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <p className="text-xs font-medium text-amber-800 mb-2">Existing patients under this number:</p>
                      {addPatientSearch.map(p => (
                        <div key={p.id} className="flex items-center justify-between py-1">
                          <span className="text-sm text-amber-900">{p.name}</span>
                          <button
                            onClick={() => navigate(`/patients/${p.id}`)}
                            className="text-xs text-indigo-600 hover:underline"
                          >
                            View Profile
                          </button>
                        </div>
                      ))}
                      <p className="text-xs text-amber-700 mt-2">You can add another patient under the same number below.</p>
                    </div>
                  ) : (
                    <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">No existing patients found for this number. A new customer record will be created.</p>
                  )}
                </div>
              )}

              {/* Step 2 — Patient details (show after search) */}
              {addPatientSearch !== null && (
                <div className="space-y-3 border-t border-gray-100 pt-4">
                  <p className="text-sm font-medium text-gray-700">New Patient Details</p>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Full Name *</label>
                    <input
                      type="text"
                      value={addPatientForm.name}
                      onChange={e => setAddPatientForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="Patient full name"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Age</label>
                      <input
                        type="number"
                        value={addPatientForm.age}
                        onChange={e => setAddPatientForm(p => ({ ...p, age: e.target.value }))}
                        placeholder="Age"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Gender</label>
                      <select
                        value={addPatientForm.gender}
                        onChange={e => setAddPatientForm(p => ({ ...p, gender: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">-</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Blood Group</label>
                      <select
                        value={addPatientForm.blood_group}
                        onChange={e => setAddPatientForm(p => ({ ...p, blood_group: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">-</option>
                        <option value="A+">A+</option>
                        <option value="A-">A-</option>
                        <option value="B+">B+</option>
                        <option value="B-">B-</option>
                        <option value="O+">O+</option>
                        <option value="O-">O-</option>
                        <option value="AB+">AB+</option>
                        <option value="AB-">AB-</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            {addPatientSearch !== null && (
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
                <button onClick={handleCloseAddPatient} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                <button
                  onClick={handleAddPatient}
                  disabled={addPatientSaving || !addPatientForm.name.trim()}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {addPatientSaving ? 'Saving...' : 'Add Patient'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getEHRPatients } from '../services/ehr.service';
import { getStoredStaff } from '../services/auth.service';
import useStore from '../store/useStore';
import { TableRowSkeleton } from '../components/shared/Skeleton';

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

  useEffect(() => {
    if (!isPro) return;
    const timer = setTimeout(fetchPatients, 500);
    return () => clearTimeout(timer);
  }, [search]);

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

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
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
        <input
          type="text"
          placeholder="Search name or phone..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
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
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
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
              {filtered.map(p => {
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
    </div>
  );
}

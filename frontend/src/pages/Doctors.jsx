import React, { useState, useEffect, useRef } from 'react';
import { getDoctors, createDoctor, updateDoctor, deleteDoctor, updateAvailability, addLeave, getTokenQueue, updateTokenStatus } from '../services/clinic.service';

const SPECIALIZATIONS = [
  'Ayurveda','Anaesthesiology','Cardiology',
  'Dentistry','Dermatology','ENT',
  'Endocrinology','Gastroenterology',
  'General Medicine','General Surgery',
  'Gynaecology','Homoeopathy','Nephrology',
  'Neurology','Oncology','Ophthalmology',
  'Orthopaedics','Paediatrics','Pathology',
  'Psychiatry','Pulmonology','Radiology',
  'Rheumatology','Urology'
];

const QUALIFICATIONS = [
  'BAMS','BHMS','BDS','DCH','DGO','DM',
  'DNB','FRCS','MBBS','MBBS MD','MBBS MS',
  'MBBS DNB','MCh','MD','MDS','MRCP','MS'
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
  const [doctors, setDoctors] = useState([]);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);

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
      alert(`Failed to ${manageMode} doctor`);
    }
  };

  const handleDeleteDoctor = async (doctorId) => {
    try {
      await deleteDoctor(doctorId);
      fetchDoctors();
      alert('Doctor removed successfully');
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to remove doctor');
    }
  };

  const handleToggleAvailability = async (doc) => {
    if (doc.available_today) {
      // Trying to mark unavailable, open modal
      setLeaveModalDoc(doc);
    } else {
      // Mark available
      try {
        await updateAvailability(doc.id, { available: true, leaveDays: 0 });
        fetchDoctors();
      } catch (err) {
        alert('Failed to update availability');
      }
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
      alert('Failed to register leave');
    }
  };

  const handleTokenAction = async (tokenId, status) => {
    try {
      await updateTokenStatus(tokenId, status);
      fetchQueue();
    } catch (err) {
      alert('Failed to update token status');
    }
  };

  const tokenStatusColors = {
    waiting: 'bg-yellow-100 text-yellow-800',
    in_progress: 'bg-blue-100 text-blue-800',
    done: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800'
  };

  return (
    <div className="p-8 space-y-8">
      {/* SECTION 1 - Doctor Management */}
      <div>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Doctors</h2>
          <button 
            onClick={openAddDoctor}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold shadow-sm hover:bg-blue-700 transition"
          >
            + Add Doctor
          </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {loading && doctors.length === 0 ? <p>Loading doctors...</p> : doctors.map(doc => (
            <div key={doc.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex flex-col justify-between hover:shadow-md transition">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{doc.name}</h3>
                <p className="text-sm text-gray-500 mb-2">{doc.specialization || 'General'}</p>
                <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded-md mb-4 space-y-1">
                  <p><span className="font-medium text-gray-500">Qualification:</span> {doc.qualification || 'N/A'}</p>
                  <p><span className="font-medium text-gray-500">Consultation:</span> ₹{doc.consultation_fee || 0}</p>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100 flex items-center justify-end space-x-3">
                <button
                  onClick={() => openEditDoctor(doc)}
                  className="text-gray-400 hover:text-blue-600 transition"
                  title="Edit Doctor"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                </button>
                <button
                  onClick={() => handleDeleteDoctor(doc.id)}
                  className="text-gray-400 hover:text-red-600 transition"
                  title="Remove Doctor"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 2 - Today's Availability */}
      <div className="pt-8 border-t border-gray-200">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Today's Availability</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {doctors.map(doc => (
            <div key={doc.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 flex flex-col justify-between">
              <div>
                <h3 className="text-md font-bold text-gray-900">{doc.name}</h3>
                <div className="text-sm text-gray-600 my-3">
                  {doc.available_today ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      Available
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                      On Leave {doc.leave_days > 0 ? `(${doc.leave_days}d)` : ''}
                    </span>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
                <span className="text-sm text-gray-500">Max tokens: {doc.max_tokens_daily}</span>
                <button
                  onClick={() => handleToggleAvailability(doc)}
                  className={`px-4 py-2 rounded-md text-sm font-medium ${
                    doc.available_today 
                      ? 'bg-red-50 text-red-700 hover:bg-red-100' 
                      : 'bg-green-50 text-green-700 hover:bg-green-100'
                  }`}
                >
                  {doc.available_today ? 'Mark Absent' : 'Mark Present'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 3 - Token Queue */}
      <div className="pt-8 border-t border-gray-200">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Token Queue (Live)</h2>
        <div className="bg-white shadow overflow-x-auto sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Token No</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Patient Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Doctor</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {queue.length === 0 ? (
                <tr><td colSpan="5" className="px-6 py-4 text-center text-sm text-gray-500">Queue is empty</td></tr>
              ) : queue.map((t, idx) => (
                <tr key={t.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-6 py-4 whitespace-nowrap text-lg font-bold text-gray-900">#{t.token_number}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{t.patient_name || 'Unknown'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{t.doctor_name}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${tokenStatusColors[t.status] || 'bg-gray-100 text-gray-800'}`}>
                      {t.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                    {t.status === 'waiting' && (
                      <button onClick={() => handleTokenAction(t.id, 'in_progress')} className="text-blue-600 hover:text-blue-900">Start</button>
                    )}
                    {t.status === 'in_progress' && (
                      <button onClick={() => handleTokenAction(t.id, 'done')} className="text-green-600 hover:text-green-900">Done</button>
                    )}
                    {(t.status === 'waiting' || t.status === 'in_progress') && (
                      <button onClick={() => handleTokenAction(t.id, 'cancelled')} className="text-red-600 hover:text-red-900">Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
                <input type="text" value={manageDoctorForm.name || ''} onChange={e => setManageDoctorForm({...manageDoctorForm, name: formatDoctorName(e.target.value)})} className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 bg-gray-50 focus:ring-blue-500 focus:border-blue-500 border ${formErrors.name ? 'border-red-500' : ''}`} />
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
                  <input type="text" value={manageDoctorForm.phone} onChange={e => { const numericOnly = e.target.value.replace(/\D/g, '').slice(0, 10); setManageDoctorForm({...manageDoctorForm, phone: numericOnly}); }} className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 bg-gray-50 focus:ring-blue-500 focus:border-blue-500 border ${formErrors.phone ? 'border-red-500' : ''}`} />
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
                  <input type="number" min="1" max="100" value={manageDoctorForm.maxTokensDaily} onChange={e => setManageDoctorForm({...manageDoctorForm, maxTokensDaily: e.target.value})} className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 bg-gray-50 focus:ring-blue-500 focus:border-blue-500 border ${formErrors.maxTokensDaily ? 'border-red-500' : ''}`} />
                  {formErrors.maxTokensDaily && <p className="mt-1 text-xs text-red-600">{formErrors.maxTokensDaily}</p>}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Consultation Fee *</label>
                <input type="text" placeholder="e.g. 300" value={manageDoctorForm.consultationFee} onChange={e => { const numericOnly = e.target.value.replace(/\D/g, ''); setManageDoctorForm({...manageDoctorForm, consultationFee: numericOnly}); }} className={`mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 bg-gray-50 focus:ring-blue-500 focus:border-blue-500 border ${formErrors.consultationFee ? 'border-red-500' : ''}`} />
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


    </div>
  );
};

export default Doctors;

import React, { useState, useEffect } from 'react';
import { getDoctors, updateAvailability, addLeave, getTokenQueue, updateTokenStatus } from '../services/clinic.service';

const Doctors = () => {
  const [doctors, setDoctors] = useState([]);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);

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
      const res = await getDoctors();
      setDoctors(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchQueue = async () => {
    try {
      const res = await getTokenQueue();
      setQueue(res.data || []);
    } catch (err) {
      console.error(err);
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
      {/* SECTION 1 - Doctors */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Doctor Availability</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {loading && doctors.length === 0 ? <p>Loading doctors...</p> : doctors.map(doc => (
            <div key={doc.id} className="bg-white rounded-lg shadow border border-gray-200 p-6 flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{doc.name}</h3>
                <p className="text-sm text-gray-500 mb-4">{doc.specialization || 'General'}</p>
                
                <div className="text-sm text-gray-600 mb-6">
                  {doc.available_today ? (
                    <span className="text-green-600 font-medium">Available</span>
                  ) : (
                    <span className="text-red-500 font-medium">On Leave {doc.leave_days > 0 ? `(${doc.leave_days} days)` : ''}</span>
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

      {/* SECTION 2 - Token Queue */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Token Queue (Live)</h2>
        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
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
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">Dr. {t.doctor_name}</td>
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
    </div>
  );
};

export default Doctors;

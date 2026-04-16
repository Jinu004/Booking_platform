import React, { useState, useEffect } from 'react';
import { getPatients, getPatientById, updatePatient } from '../services/patient.service';

const Patients = () => {
  const [patients, setPatients] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  
  // Modal state
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      fetchPatients();
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [search]);

  const fetchPatients = async () => {
    try {
      setLoading(true);
      const res = await getPatients({ search, limit: 20 });
      setPatients(res.data?.customers || []);
      setTotal(res.data?.total || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const openProfile = async (id) => {
    try {
      const res = await getPatientById(id);
      setSelectedPatient(res.data);
      setNotes(res.data?.notes || '');
    } catch (err) {
      alert('Failed to load profile');
    }
  };

  const closeProfile = () => {
    setSelectedPatient(null);
    setNotes('');
  };

  const saveNotes = async () => {
    if (!selectedPatient) return;
    setSavingNotes(true);
    try {
      await updatePatient(selectedPatient.id, { notes });
      setSelectedPatient({ ...selectedPatient, notes });
      fetchPatients(); // refresh table
    } catch (err) {
      alert('Failed to save notes');
    } finally {
      setSavingNotes(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Patients ({total})</h1>
        <div className="w-64">
          <input
            type="text"
            placeholder="Search name or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border-gray-300 rounded-md shadow-sm p-2"
          />
        </div>
      </div>

      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Visit</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total Visits</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan="5" className="text-center py-4">Loading...</td></tr>
            ) : patients.length === 0 ? (
              <tr><td colSpan="5" className="text-center py-4 text-gray-500">No patients found</td></tr>
            ) : (
              patients.map(p => (
                <tr key={p.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{p.name || '-'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{p.phone}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {p.last_seen ? new Date(p.last_seen).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{p.visits_count || 0}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button onClick={() => openProfile(p.id)} className="text-indigo-600 hover:text-indigo-900">View Profile</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedPatient && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{selectedPatient.name || 'Unknown'}</h2>
                <p className="text-gray-500">{selectedPatient.phone}</p>
                {selectedPatient.date_of_birth && <p className="text-sm text-gray-500 mt-1">DOB: {new Date(selectedPatient.date_of_birth).toLocaleDateString()}</p>}
              </div>
              <button onClick={closeProfile} className="text-gray-400 hover:text-gray-500 text-xl font-bold">&times;</button>
            </div>

            <div className="mb-6 border-t border-gray-200 pt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows="3"
                className="w-full border-gray-300 rounded-md shadow-sm p-2 bg-gray-50"
              />
              <button 
                onClick={saveNotes} 
                disabled={savingNotes || notes === selectedPatient.notes}
                className="mt-2 bg-indigo-600 text-white px-3 py-1 rounded shadow text-sm disabled:opacity-50"
              >
                {savingNotes ? 'Saving...' : 'Save Notes'}
              </button>
            </div>

            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">Visit History</h3>
              {(!selectedPatient.history || selectedPatient.history.length === 0) ? (
                <p className="text-sm text-gray-500">No past visits</p>
              ) : (
                <ul className="divide-y divide-gray-200">
                  {selectedPatient.history.map(visit => (
                    <li key={visit.id} className="py-4">
                      <div className="flex space-x-3">
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-medium">Dr. {visit.doctor_name || 'Unassigned'}</h3>
                            <p className="text-sm text-gray-500">{new Date(visit.booking_date).toLocaleDateString()}</p>
                          </div>
                          <p className="text-sm text-gray-500">Token #{visit.token_number} - Status: {visit.status}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Patients;

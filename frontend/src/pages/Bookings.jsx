import React, { useState, useEffect } from 'react';
import { 
  getBookings, getBookingStats, 
  completeBooking, cancelBooking, markNoShow, createBooking 
} from '../services/booking.service';
import { getDoctors } from '../services/clinic.service'; // We will create this
import { getPatients } from '../services/patient.service'; // We will create this

const Bookings = () => {
  const [bookings, setBookings] = useState([]);
  const [stats, setStats] = useState({ total: 0, confirmed: 0, completed: 0, noshow: 0 });
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [statusFilter, setStatusFilter] = useState('');
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [doctors, setDoctors] = useState([]);
  const [patients, setPatients] = useState([]);
  
  const [newBooking, setNewBooking] = useState({
    customerId: '',
    doctorId: '',
    bookingDate: date,
    notes: ''
  });

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // 30s poll
    return () => clearInterval(interval);
  }, [date, statusFilter]);

  const fetchData = async () => {
    try {
      const [bookingsRes, statsRes] = await Promise.all([
        getBookings({ date, status: statusFilter }),
        getBookingStats()
      ]);
      setBookings(bookingsRes.data?.bookings || []);
      setStats(statsRes.data || { total: 0, confirmed: 0, completed: 0, noshow: 0 });
    } catch (err) {
      console.error('Failed to fetch bookings', err);
    } finally {
      setLoading(false);
    }
  };

  const loadFormDependencies = async () => {
    try {
      const [docRes, patRes] = await Promise.all([
         getDoctors(true).catch(() => ({ data: [] })),
         getPatients({ limit: 100 }).catch(() => ({ data: { customers: [] } }))
      ]);
      setDoctors(docRes.data || []);
      setPatients(patRes.data?.customers || []);
    } catch(err) {
      console.error(err);
    }
  };

  const handleAction = async (id, actionFn) => {
    try {
      await actionFn(id);
      fetchData(); // Refresh seamlessly
    } catch (err) {
      alert(err.response?.data?.error || 'Action failed');
    }
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    try {
      await createBooking(newBooking);
      setIsModalOpen(false);
      setNewBooking({ customerId: '', doctorId: '', bookingDate: date, notes: '' });
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create booking');
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
    <div className="p-8 space-y-6">
      {/* Top Bar */}
      <div className="flex justify-between items-center">
        <div className="flex space-x-4">
          <input 
            type="date" 
            value={date} 
            onChange={e => setDate(e.target.value)}
            className="border-gray-300 rounded-md shadow-sm p-2"
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
          onClick={() => {
            loadFormDependencies();
            setIsModalOpen(true);
          }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-md shadow hover:bg-indigo-700"
        >
          + New Booking
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
          <p className="text-sm text-gray-500">Total Today</p>
          <p className="text-2xl font-bold">{stats.total || 0}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
          <p className="text-sm text-gray-500">Confirmed</p>
          <p className="text-2xl font-bold text-blue-600">{stats.confirmed || 0}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
          <p className="text-sm text-gray-500">Completed</p>
          <p className="text-2xl font-bold text-green-600">{stats.completed || 0}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
          <p className="text-sm text-gray-500">No Shows</p>
          <p className="text-2xl font-bold text-gray-600">{stats.noshow || 0}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Token</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Patient</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Doctor</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time/Source</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan="6" className="text-center py-4">Loading...</td></tr>
            ) : bookings.length === 0 ? (
              <tr><td colSpan="6" className="text-center py-4 text-gray-500">No bookings found</td></tr>
            ) : (
              bookings.map(b => (
                <tr key={b.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                    #{b.token_number || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{b.patient_name || 'Unknown'}</div>
                    <div className="text-sm text-gray-500">{b.patient_phone}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {b.doctor_name || 'Unassigned'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(b.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    <span className="block text-xs uppercase text-gray-400">{b.source}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusColors[b.status]}`}>
                      {b.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                    {(b.status === 'confirmed' || b.status === 'pending') && (
                      <>
                        <button onClick={() => handleAction(b.id, completeBooking)} className="text-green-600 hover:text-green-900">Complete</button>
                        <button onClick={() => handleAction(b.id, markNoShow)} className="text-gray-600 hover:text-gray-900">No Show</button>
                        <button onClick={() => handleAction(b.id, cancelBooking)} className="text-red-600 hover:text-red-900">Cancel</button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h2 className="text-lg font-medium mb-4">New Booking</h2>
            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Patient</label>
                <select 
                  required
                  value={newBooking.customerId}
                  onChange={e => setNewBooking({...newBooking, customerId: e.target.value})}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 bg-gray-50"
                >
                  <option value="">Select Patient...</option>
                  {patients.map(p => (
                    <option key={p.id} value={p.id}>{p.name || p.phone} ({p.phone})</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700">Doctor</label>
                <select 
                  required
                  value={newBooking.doctorId}
                  onChange={e => setNewBooking({...newBooking, doctorId: e.target.value})}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 bg-gray-50"
                >
                  <option value="">Select Doctor...</option>
                  {doctors.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.specialization})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Date</label>
                <input 
                  type="date"
                  required
                  value={newBooking.bookingDate}
                  onChange={e => setNewBooking({...newBooking, bookingDate: e.target.value})}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 bg-gray-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Notes (Optional)</label>
                <textarea 
                  value={newBooking.notes}
                  onChange={e => setNewBooking({...newBooking, notes: e.target.value})}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 bg-gray-50"
                />
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Bookings;

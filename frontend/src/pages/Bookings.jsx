import React, { useState, useEffect } from 'react';
import { 
  getBookings, getBookingStats, 
  completeBooking, cancelBooking, markNoShow, createBooking 
} from '../services/booking.service';
import { getDoctors } from '../services/clinic.service';
import api from '../utils/api';
import TokenReceipt from '../components/shared/TokenReceipt';
import { TableRowSkeleton, StatCardSkeleton } from '../components/shared/Skeleton';

const Bookings = () => {
  const [bookings, setBookings] = useState([]);
  const [stats, setStats] = useState({ total: 0, confirmed: 0, completed: 0, noshow: 0 });
  const [loading, setLoading] = useState(true);
  
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [statusFilter, setStatusFilter] = useState('');
  
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [doctors, setDoctors] = useState([]);
  
  const [newBooking, setNewBooking] = useState({
    patientName: '',
    patientPhone: '',
    doctorId: '',
    notes: ''
  });

  const [receiptBooking, setReceiptBooking] = useState(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // 30s poll
    return () => clearInterval(interval);
  }, [date, statusFilter]);

  const fetchData = async () => {
    try {
      const [bookingsRes, statsRes, docsRes] = await Promise.all([
        getBookings({ date, status: statusFilter }),
        getBookingStats(),
        getDoctors()
      ]);
      setBookings(bookingsRes?.data?.bookings || bookingsRes?.data || []);
      setStats(statsRes?.data || { total: 0, confirmed: 0, completed: 0, noshow: 0 });
      setDoctors(docsRes?.data || []);
    } catch (err) {
      console.error('Failed to fetch bookings', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredBookings = selectedDoctor
    ? bookings.filter(b => b.doctor_name === selectedDoctor.name)
    : bookings;

  const loadFormDependencies = async () => {
    try {
      const docRes = await getDoctors(true).catch(() => ({ data: [] }));
      setDoctors(docRes.data || []);
    } catch(err) {
      console.error(err);
    }
  };

  const handleAction = async (id, actionFn) => {
    try {
      await actionFn(id);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Action failed');
    }
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post('/bookings/manual', newBooking);
      setReceiptBooking(data.data);
      setIsModalOpen(false);
      setNewBooking({ patientName: '', patientPhone: '', doctorId: '', notes: '' });
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
    <div className="p-8 space-y-6 relative">
      <div className="flex flex-col md:flex-row flex-wrap justify-between items-start md:items-center gap-4">
        <div className="flex flex-wrap items-center gap-2 md:gap-4 w-full md:w-auto">
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
          className="bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition transform hover:scale-105"
        >
          + New Booking
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {['Total Today', 'Confirmed', 'Completed', 'No Shows'].map((s, i) => {
          const vals = [stats.total, stats.confirmed, stats.completed, stats.noshow];
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
        <button
          onClick={() => setSelectedDoctor(null)}
          className={selectedDoctor === null
            ? 'bg-blue-600 text-white px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium whitespace-nowrap shadow-sm shadow-blue-200'
            : 'bg-white text-gray-600 px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium border whitespace-nowrap hover:bg-gray-50'
          }
        >
          All Doctors ({bookings.length})
        </button>

        {doctors.map(doctor => {
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
              <tr><td colSpan="6" className="text-center py-10 text-gray-500 font-medium">No bookings found</td></tr>
            ) : (
              filteredBookings.map(b => (
                <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-black text-indigo-700">
                    <div className="bg-indigo-50 w-10 h-10 flex items-center justify-center rounded-full">
                      {b.token_number || '-'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-bold text-gray-900">{b.patient_name || 'Unknown'}</div>
                    <div className="text-sm text-gray-500 font-medium">{b.patient_phone}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">
                    {b.doctor_name || 'Unassigned'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-medium">
                    {new Date(b.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
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
                        <button onClick={() => handleAction(b.id, completeBooking)} className="text-emerald-600 hover:text-emerald-800 transition">Complete</button>
                        <button onClick={() => handleAction(b.id, cancelBooking)} className="text-red-500 hover:text-red-700 transition">Cancel</button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-70 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl p-8 max-w-lg w-full transform transition-all duration-300">
            <h2 className="text-2xl font-black text-gray-900 mb-6">Issue New Token</h2>
            <form onSubmit={handleCreateSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Patient Phone <span className="text-red-500">*</span></label>
                <div className="flex relative">
                  <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm font-bold">+91</span>
                  <input 
                    type="tel" required
                    value={newBooking.patientPhone}
                    onChange={e => setNewBooking({...newBooking, patientPhone: e.target.value.replace(/\D/g, '').slice(0, 10)})}
                    className="flex-1 rounded-none rounded-r-md border border-gray-300 p-2 font-bold focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="9876543210"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Patient Name</label>
                <input 
                  type="text" 
                  value={newBooking.patientName}
                  onChange={e => setNewBooking({...newBooking, patientName: e.target.value})}
                  className="block w-full rounded-md border border-gray-300 p-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="New Patient Name (Optional)"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Assign Doctor <span className="text-red-500">*</span></label>
                <select 
                  required
                  value={newBooking.doctorId}
                  onChange={e => setNewBooking({...newBooking, doctorId: e.target.value})}
                  className="block w-full rounded-md border border-gray-300 p-2 bg-gray-50 font-medium"
                >
                  <option value="">Select Doctor...</option>
                  {doctors.map(d => (
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

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 rounded-lg text-gray-700 font-bold hover:bg-gray-100 transition">Cancel</button>
                <button type="submit" className="px-6 py-2.5 bg-indigo-600 font-bold text-white rounded-lg hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition transform hover:scale-105">Issue Token</button>
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

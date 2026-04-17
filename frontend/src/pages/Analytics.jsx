import React, { useState, useEffect } from 'react';
import { 
  getOverview, 
  getDailyBookings, 
  getDoctorStats, 
  getConversationStats 
} from '../services/analytics.service';
// If recharts is not installed, the user might see errors, but per prompt we assume recharts is used.
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar, Legend
} from 'recharts';

const Analytics = () => {
  const [period, setPeriod] = useState('month');
  const [loading, setLoading] = useState(true);
  
  const [overview, setOverview] = useState({
    bookings: { total: 0, completed: 0, cancelled: 0, noshow: 0 },
    patients: { new: 0 },
    aiStats: { resolutionRate: 0 }
  });
  const [dailyData, setDailyData] = useState([]);
  const [doctorData, setDoctorData] = useState([]);
  const [convData, setConvData] = useState({ total: 0, aiHandled: 0, escalated: 0, resolved: 0 });

  useEffect(() => {
    fetchData();
  }, [period]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [oRes, dRes, docRes, cRes] = await Promise.all([
        getOverview(period).catch(() => ({ data: overview })),
        getDailyBookings().catch(() => ({ data: [] })),
        getDoctorStats().catch(() => ({ data: [] })),
        getConversationStats(period).catch(() => ({ data: convData }))
      ]);

      setOverview(oRes.data || overview);
      if (period === 'month') {
        const formattedDaily = (dRes.data || []).map(d => ({
          date: new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          bookings: d.count
        }));
        setDailyData(formattedDaily);
      }
      setDoctorData(docRes.data || []);
      setConvData(cRes.data || convData);
      
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const calculateCompletionRate = () => {
    if (overview.bookings.total === 0) return 0;
    return Math.round((overview.bookings.completed / overview.bookings.total) * 100);
  };

  return (
    <div className="p-8 space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
        <div className="space-x-2 bg-gray-100 p-1 rounded-lg border border-gray-200">
          {['today', 'week', 'month'].map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded-md text-sm font-medium capitalize ${
                period === p 
                ? 'bg-white shadow text-indigo-600' 
                : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'Today'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-500 font-medium">Loading Analytics...</div>
      ) : (
        <>
          {/* Row 1: Stat Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
              <p className="text-sm font-medium text-gray-500">Total Bookings</p>
              <p className="mt-2 text-3xl font-semibold text-gray-900">{overview.bookings.total}</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
              <p className="text-sm font-medium text-gray-500">Completion Rate</p>
              <p className="mt-2 text-3xl font-semibold text-blue-600">{calculateCompletionRate()}%</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
              <p className="text-sm font-medium text-gray-500">New Patients</p>
              <p className="mt-2 text-3xl font-semibold text-green-600">{overview.patients.new}</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
              <p className="text-sm font-medium text-gray-500">AI Resolution Rate</p>
              <p className="mt-2 text-3xl font-semibold text-purple-600">{overview.aiStats.resolutionRate}%</p>
            </div>
          </div>

          {/* Row 2: Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
              <h2 className="text-lg font-bold text-gray-900 mb-6">Daily Bookings (Last 30 Days)</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <RechartsTooltip />
                    <Line type="monotone" dataKey="bookings" stroke="#4f46e5" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
              <h2 className="text-lg font-bold text-gray-900 mb-6">Doctor Performance</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={doctorData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="doctorName" />
                    <YAxis />
                    <RechartsTooltip />
                    <Legend />
                    <Bar dataKey="totalBookings" fill="#6366f1" name="Total Bookings" />
                    <Bar dataKey="completed" fill="#10b981" name="Completed" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Row 3: Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                <h2 className="text-lg font-bold text-gray-900">Doctor Stats</h2>
              </div>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-white">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Doctor</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Bookings</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Completed</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Revenue</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {doctorData.map((d, idx) => (
                    <tr key={idx}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{d.doctorName}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-500">{d.totalBookings}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-500">{d.completed}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-500">₹{d.revenue}</td>
                    </tr>
                  ))}
                  {doctorData.length === 0 && <tr><td colSpan="4" className="text-center py-4 text-gray-500">No data available</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                <h2 className="text-lg font-bold text-gray-900">Conversation Stats</h2>
              </div>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-white">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Metric</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  <tr>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">Total Conversations</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900 font-medium">{convData.total || 0}</td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">AI Handled</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-green-600 font-medium">{convData.aiHandled || 0}</td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">Escalated to Staff</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-red-600 font-medium">{convData.escalated || 0}</td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">Resolved</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-blue-600 font-medium">{convData.resolved || 0}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Analytics;

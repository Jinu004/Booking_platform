import React, { useState, useEffect } from 'react';
import {
  getOverview,
  getDailyBookings,
  getDoctorStats,
  getConversationStats,
  getEnquiryOverview,
  getEnquiryDailyLeads,
  getTopProducts
} from '../services/analytics.service';
import { useIndustry } from '../hooks/useIndustry';
// If recharts is not installed, the user might see errors, but per prompt we assume recharts is used.
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar, Legend
} from 'recharts';
import { StatCardSkeleton, TableRowSkeleton } from '../components/shared/Skeleton';
import useStore from '../store/useStore';

const Analytics = () => {
  const { addToast } = useStore();
  const { industry } = useIndustry();
  const [period, setPeriod] = useState('month');

  // ── Clinic state ─────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState({
    bookings: { total: 0, completed: 0, cancelled: 0, noshow: 0 },
    patients: { new: 0 },
    aiStats: { resolutionRate: 0 }
  });
  const [dailyData, setDailyData] = useState([]);
  const [doctorData, setDoctorData] = useState([]);
  const [convData, setConvData] = useState({ total: 0, aiHandled: 0, escalated: 0, resolved: 0 });

  // ── Enquiry state ─────────────────────────────────────────────────────────────
  const [enquiryLoading, setEnquiryLoading] = useState(true);
  const [enquiryOverview, setEnquiryOverview] = useState({
    leads: { total: 0, new: 0, in_progress: 0, shipped: 0, delivered: 0 },
    revenue: { total: 0, unpaid_count: 0 },
    aiStats: { resolutionRate: 0 }
  });
  const [enquiryDaily, setEnquiryDaily] = useState({ daily: [] });
  const [enquiryProducts, setEnquiryProducts] = useState({ products: [] });

  // ── Effects ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (industry !== 'enquiry') {
      fetchData();
    }
  }, [period, industry]);

  useEffect(() => {
    if (industry === 'enquiry') {
      fetchEnquiryData();
    }
  }, [period, industry]);

  // ── Clinic fetch ──────────────────────────────────────────────────────────────
  const fetchData = async () => {
    try {
      setLoading(true);
      const [oRes, dRes, docRes, cRes] = await Promise.all([
        getOverview(period).catch(() => ({ data: overview })),
        getDailyBookings(period).catch(() => ({ data: [] })),
        getDoctorStats().catch(() => ({ data: [] })),
        getConversationStats(period).catch(() => ({ data: convData }))
      ]);

      setOverview(oRes.data || overview);
      if (period === 'month') {
        const formattedDaily = (dRes.data || []).map(d => ({
          date: new Date(d.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
          bookings: d.count
        }));
        setDailyData(formattedDaily);
      }
      setDoctorData(docRes.data || []);
      setConvData(cRes.data || convData);

    } catch (err) {
      addToast('Failed to load analytics', 'error');
    } finally {
      setLoading(false);
    }
  };

  // ── Enquiry fetch ─────────────────────────────────────────────────────────────
  const fetchEnquiryData = async () => {
    setEnquiryLoading(true);
    const ovFallback = {
      leads: { total: 0, new: 0, in_progress: 0, shipped: 0, delivered: 0 },
      revenue: { total: 0, unpaid_count: 0 },
      aiStats: { resolutionRate: 0 }
    };
    try {
      const [ovRes, dailyRes, prodRes] = await Promise.all([
        getEnquiryOverview(period).catch(() => ovFallback),
        getEnquiryDailyLeads(period).catch(() => ({ daily: [] })),
        getTopProducts(period).catch(() => ({ products: [] })),
      ]);
      setEnquiryOverview(ovRes || ovFallback);
      setEnquiryDaily(dailyRes || { daily: [] });
      setEnquiryProducts(prodRes || { products: [] });
    } catch {
      addToast('Failed to load analytics', 'error');
    } finally {
      setEnquiryLoading(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const calculateCompletionRate = () => {
    if (overview.bookings.total === 0) return 0;
    return Math.round((overview.bookings.completed / overview.bookings.total) * 100);
  };

  const formattedEnquiryDaily = (enquiryDaily.daily || []).map(d => ({
    date: new Date(d.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
    count: d.count
  }));

  const formattedProducts = (enquiryProducts.products || []).map(p => ({
    ...p,
    product_name: (p.product_name || '').length > 12
      ? (p.product_name || '').slice(0, 12) + '…'
      : (p.product_name || '')
  }));

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="p-8 space-y-8">

      {/* ══════════════════════════════════════════════════════════════════════
          CLINIC ANALYTICS
      ══════════════════════════════════════════════════════════════════════ */}
      {industry !== 'enquiry' && (
        <>
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
            <div className="space-x-2 bg-gray-100 p-1 rounded-lg border border-gray-200">
              {['today', 'week', 'month'].map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-4 py-2 rounded-md text-sm font-medium capitalize ${period === p
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
            <>
              {/* Row 1: Stat Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
              </div>

              {/* Row 2: Chart Placeholders */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-6 rounded-lg shadow border border-gray-200 animate-pulse">
                  <div className="h-5 bg-gray-200 rounded w-2/5 mb-6"></div>
                  <div className="h-64 bg-gray-200 rounded-lg"></div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow border border-gray-200 animate-pulse">
                  <div className="h-5 bg-gray-200 rounded w-1/3 mb-6"></div>
                  <div className="h-64 bg-gray-200 rounded-lg"></div>
                </div>
              </div>

              {/* Row 3: Table Placeholders */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Doctor Stats table skeleton */}
                <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden animate-pulse">
                  <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                    <div className="h-5 bg-gray-200 rounded w-1/3"></div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {/* Column header row */}
                    <div className="px-6 py-3 flex items-center gap-4">
                      <div className="h-3 bg-gray-200 rounded w-1/4"></div>
                      <div className="ml-auto flex gap-6">
                        <div className="h-3 bg-gray-200 rounded w-14"></div>
                        <div className="h-3 bg-gray-200 rounded w-14"></div>
                        <div className="h-3 bg-gray-200 rounded w-14"></div>
                      </div>
                    </div>
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="px-6 py-4 flex items-center gap-4">
                        <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                        <div className="ml-auto flex gap-6">
                          <div className="h-4 bg-gray-200 rounded w-10"></div>
                          <div className="h-4 bg-gray-200 rounded w-10"></div>
                          <div className="h-4 bg-gray-200 rounded w-12"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Conversation Stats table skeleton */}
                <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden animate-pulse">
                  <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                    <div className="h-5 bg-gray-200 rounded w-2/5"></div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {/* Column header row */}
                    <div className="px-6 py-3 flex items-center justify-between">
                      <div className="h-3 bg-gray-200 rounded w-1/4"></div>
                      <div className="h-3 bg-gray-200 rounded w-12"></div>
                    </div>
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="px-6 py-4 flex items-center justify-between">
                        <div className="h-4 bg-gray-200 rounded w-2/5"></div>
                        <div className="h-4 bg-gray-200 rounded w-10"></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
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
                  <h2 className="text-lg font-bold text-gray-900 mb-6">Daily Bookings ({period === 'today' ? 'Today' : period === 'week' ? 'This Week' : 'This Month'})</h2>              <div className="h-64">
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
                  <div className="overflow-x-auto">
                    <table className="min-w-[500px] w-full divide-y divide-gray-200">
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
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          ENQUIRY ANALYTICS
      ══════════════════════════════════════════════════════════════════════ */}
      {industry === 'enquiry' && (
        <>
          {/* Heading + period toggle */}
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-[#1E2E45]">Analytics Dashboard</h1>
            <div className="space-x-2 bg-white p-1 rounded-lg border border-[#D0DCE8]">
              {['today', 'week', 'month'].map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-4 py-2 rounded-md text-sm font-medium capitalize ${period === p
                    ? 'bg-[#EBF3FA] shadow-sm text-[#4A91C4] font-semibold'
                    : 'text-gray-500 hover:text-[#4A91C4]'
                    }`}
                >
                  {p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'Today'}
                </button>
              ))}
            </div>
          </div>

          {enquiryLoading ? (
            <>
              {/* Row 1: Stat Cards skeleton */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
              </div>

              {/* Row 2: Chart Placeholders */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-6 rounded-lg shadow border border-[#D0DCE8] animate-pulse">
                  <div className="h-5 bg-gray-200 rounded w-2/5 mb-6"></div>
                  <div className="h-64 bg-gray-200 rounded-lg"></div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow border border-[#D0DCE8] animate-pulse">
                  <div className="h-5 bg-gray-200 rounded w-1/3 mb-6"></div>
                  <div className="h-64 bg-gray-200 rounded-lg"></div>
                </div>
              </div>

              {/* Row 3: Table Placeholders */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white rounded-lg shadow border border-[#D0DCE8] overflow-hidden animate-pulse">
                  <div className="px-6 py-4 border-b border-[#D0DCE8] bg-[#F0F4F8]">
                    <div className="h-5 bg-gray-200 rounded w-1/3"></div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    <div className="px-6 py-3 flex items-center gap-4">
                      <div className="h-3 bg-gray-200 rounded w-1/4"></div>
                      <div className="ml-auto h-3 bg-gray-200 rounded w-14"></div>
                    </div>
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="px-6 py-4 flex items-center justify-between">
                        <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                        <div className="h-4 bg-gray-200 rounded w-10"></div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow border border-[#D0DCE8] overflow-hidden animate-pulse">
                  <div className="px-6 py-4 border-b border-[#D0DCE8] bg-[#F0F4F8]">
                    <div className="h-5 bg-gray-200 rounded w-2/5"></div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    <div className="px-6 py-3 flex items-center justify-between">
                      <div className="h-3 bg-gray-200 rounded w-1/4"></div>
                      <div className="h-3 bg-gray-200 rounded w-12"></div>
                    </div>
                    {[...Array(2)].map((_, i) => (
                      <div key={i} className="px-6 py-4 flex items-center justify-between">
                        <div className="h-4 bg-gray-200 rounded w-2/5"></div>
                        <div className="h-4 bg-gray-200 rounded w-10"></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Row 1: Stat Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">

                {/* Total Orders */}
                <div className="bg-white p-6 rounded-lg shadow border border-[#D0DCE8]">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-gray-500">Total Orders</p>
                    <span className="p-2 bg-[#EBF3FA] rounded-lg">
                      <svg className="w-5 h-5 text-[#4A91C4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </span>
                  </div>
                  <p className="text-3xl font-semibold text-[#1E2E45]">{enquiryOverview.leads?.total ?? 0}</p>
                </div>

                {/* Delivered */}
                <div className="bg-white p-6 rounded-lg shadow border border-[#D0DCE8]">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-gray-500">Delivered</p>
                    <span className="p-2 bg-green-50 rounded-lg">
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </span>
                  </div>
                  <p className="text-3xl font-semibold text-green-600">{enquiryOverview.leads?.delivered ?? 0}</p>
                </div>

                {/* Total Revenue */}
                <div className="bg-white p-6 rounded-lg shadow border border-[#D0DCE8]">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-gray-500">Total Revenue</p>
                    <span className="p-2 bg-green-50 rounded-lg">
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 8h6m-5 0a3 3 0 110 6H9l3 3m-3-6h6m6 1a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </span>
                  </div>
                  <p className="text-3xl font-semibold text-green-600">₹{(enquiryOverview.revenue?.total ?? 0).toLocaleString('en-IN')}</p>
                </div>

                {/* AI Resolution Rate */}
                <div className="bg-white p-6 rounded-lg shadow border border-[#D0DCE8]">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-gray-500">AI Resolution Rate</p>
                    <span className="p-2 bg-indigo-50 rounded-lg">
                      <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
                      </svg>
                    </span>
                  </div>
                  <p className="text-3xl font-semibold text-indigo-600">{enquiryOverview.aiStats?.resolutionRate ?? 0}%</p>
                </div>
              </div>

              {/* Row 2: Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-6 rounded-lg shadow border border-[#D0DCE8]">
                  <h2 className="text-lg font-bold text-[#1E2E45] mb-6">
                    Daily Orders ({period === 'today' ? 'Today' : period === 'week' ? 'This Week' : 'This Month'})
                  </h2>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={formattedEnquiryDaily}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <RechartsTooltip />
                        <Line type="monotone" dataKey="count" stroke="#4A91C4" strokeWidth={2} dot={false} name="Orders" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-lg shadow border border-[#D0DCE8]">
                  <h2 className="text-lg font-bold text-[#1E2E45] mb-6">Top Products</h2>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={formattedProducts}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="product_name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <RechartsTooltip />
                        <Bar dataKey="order_count" fill="#4A91C4" name="Orders" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Row 3: Tables */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* Order Pipeline */}
                <div className="bg-white rounded-lg shadow border border-[#D0DCE8] overflow-hidden">
                  <div className="px-6 py-4 border-b border-[#D0DCE8] bg-[#F0F4F8]">
                    <h2 className="text-lg font-bold text-[#1E2E45]">Order Pipeline</h2>
                  </div>
                  <table className="min-w-full divide-y divide-gray-100">
                    <thead className="bg-white">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stage</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Count</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {[
                        { key: 'new',         label: 'New',         badge: 'bg-yellow-100 text-yellow-700' },
                        { key: 'in_progress', label: 'In Progress', badge: 'bg-blue-100 text-blue-700'   },
                        { key: 'shipped',     label: 'Shipped',     badge: 'bg-purple-100 text-purple-700' },
                        { key: 'delivered',   label: 'Delivered',   badge: 'bg-green-100 text-green-700'  },
                      ].map(({ key, label, badge }) => (
                        <tr key={key}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${badge}`}>
                              {label}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-gray-900">
                            {enquiryOverview.leads?.[key] ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Payment Summary */}
                <div className="bg-white rounded-lg shadow border border-[#D0DCE8] overflow-hidden">
                  <div className="px-6 py-4 border-b border-[#D0DCE8] bg-[#F0F4F8]">
                    <h2 className="text-lg font-bold text-[#1E2E45]">Payment Summary</h2>
                  </div>
                  <table className="min-w-full divide-y divide-gray-100">
                    <thead className="bg-white">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Metric</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      <tr>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">Total Revenue</td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-green-600">
                          ₹{(enquiryOverview.revenue?.total ?? 0).toLocaleString('en-IN')}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">Unpaid Orders</td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-red-600">
                          {enquiryOverview.revenue?.unpaid_count ?? 0}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

    </div>
  );
};

export default Analytics;

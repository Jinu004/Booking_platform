import api from '../utils/api';

export async function getOverview(period) {
  const res = await api.get('/analytics/overview', { params: { period } });
  return res;
}

export async function getDailyBookings(period = 'month') {
  const res = await api.get('/analytics/bookings/daily', { params: { period } });
  return res;
}

export async function getDoctorStats() {
  const res = await api.get('/analytics/doctors');
  return res;
}

export async function getConversationStats(period) {
  const res = await api.get('/analytics/conversations', { params: { period } });
  return res;
}

export async function getEnquiryOverview(period = 'month') {
  const res = await api.get(`/analytics/enquiry/overview?period=${period}`);
  return res.data;
}

export async function getEnquiryDailyLeads(period = 'month') {
  const res = await api.get(`/analytics/enquiry/daily-leads?period=${period}`);
  return res.data;
}

export async function getTopProducts(period = 'month') {
  const res = await api.get(`/analytics/enquiry/top-products?period=${period}`);
  return res.data;
}

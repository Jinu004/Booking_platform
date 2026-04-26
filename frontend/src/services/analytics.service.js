import api from '../utils/api';

export async function getOverview(period) {
  const res = await api.get('/analytics/overview', { params: { period } });
  return res;
}

export async function getDailyBookings() {
  const res = await api.get('/analytics/bookings/daily');
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

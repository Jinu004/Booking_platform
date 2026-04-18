import api from '../utils/api';

/**
 * Gets bookings with filters
 * @param {object} params - { date, status, page }
 */
export async function getBookings(params) {
  return api.get('/bookings', { params });
}

export async function getBookingStats() {
  return api.get('/bookings/stats');
}

export async function createBooking(data) {
  return api.post('/bookings', data);
}

export async function cancelBooking(id) {
  return api.post(`/bookings/${id}/cancel`);
}

export async function completeBooking(id) {
  return api.post(`/bookings/${id}/complete`);
}

export async function markNoShow(id) {
  return api.post(`/bookings/${id}/noshow`);
}

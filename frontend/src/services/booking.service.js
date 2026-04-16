import api from '../utils/api';

/**
 * Gets bookings with filters
 * @param {object} params - { date, status, page }
 */
export async function getBookings(params) {
  const res = await api.get('/bookings', { params });
  return res.data;
}

/**
 * Gets booking statistics
 */
export async function getBookingStats() {
  const res = await api.get('/bookings/stats');
  return res.data;
}

/**
 * Creates new booking
 */
export async function createBooking(data) {
  const res = await api.post('/bookings', data);
  return res.data;
}

/**
 * Cancels a booking
 */
export async function cancelBooking(id) {
  const res = await api.post(`/bookings/${id}/cancel`);
  return res.data;
}

/**
 * Marks booking complete
 */
export async function completeBooking(id) {
  const res = await api.post(`/bookings/${id}/complete`);
  return res.data;
}

/**
 * Marks no show
 */
export async function markNoShow(id) {
  const res = await api.post(`/bookings/${id}/noshow`);
  return res.data;
}

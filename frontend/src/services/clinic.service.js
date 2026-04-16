import api from '../utils/api';

export async function getDoctors(availableOnly) {
  const params = availableOnly !== undefined ? { available: availableOnly } : {};
  const res = await api.get('/clinic/doctors', { params });
  return res.data;
}

export async function createDoctor(data) {
  const res = await api.post('/clinic/doctors', data);
  return res.data;
}

export async function updateAvailability(id, data) {
  const res = await api.patch(`/clinic/doctors/${id}/availability`, data);
  return res.data;
}

export async function addLeave(id, data) {
  const res = await api.post(`/clinic/doctors/${id}/leave`, data);
  return res.data;
}

export async function getTokenQueue() {
  const res = await api.get('/clinic/tokens');
  return res.data;
}

export async function updateTokenStatus(id, status) {
  const res = await api.patch(`/clinic/tokens/${id}/status`, { status });
  return res.data;
}

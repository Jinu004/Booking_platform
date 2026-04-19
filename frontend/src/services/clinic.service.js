import api from '../utils/api';

export async function getDoctors(availableOnly) {
  const params = availableOnly !== undefined ? { available: availableOnly } : {};
  return api.get('/clinic/doctors', { params });
}

export async function createDoctor(data) {
  return api.post('/clinic/doctors', data);
}

export async function updateDoctor(id, data) {
  return api.patch(`/clinic/doctors/${id}`, data);
}

export async function deleteDoctor(id) {
  return api.delete(`/clinic/doctors/${id}`);
}

export async function updateAvailability(id, data) {
  return api.patch(`/clinic/doctors/${id}/availability`, data);
}

export async function addLeave(id, data) {
  return api.post(`/clinic/doctors/${id}/leave`, data);
}

export async function getTokenQueue() {
  return api.get('/clinic/tokens');
}

export async function updateTokenStatus(id, status) {
  return api.patch(`/clinic/tokens/${id}/status`, { status });
}

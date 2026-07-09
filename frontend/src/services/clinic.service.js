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

export async function getDoctorSchedule(doctorId) {
  return api.get(`/clinic/doctors/${doctorId}/schedule`);
}

export async function saveDoctorSchedule(doctorId, schedules) {
  return api.post(`/clinic/doctors/${doctorId}/schedule`, { schedules });
}

export async function getProcedures(doctorId) {
  return api.get(`/clinic/doctors/${doctorId}/procedures`);
}

export async function createProcedure(doctorId, name, durationMinutes) {
  return api.post(`/clinic/doctors/${doctorId}/procedures`, { name, duration_minutes: durationMinutes });
}

export async function deleteProcedure(procedureId) {
  return api.delete(`/clinic/procedures/${procedureId}`);
}

export async function getAvailableSlots(doctorId, date, duration) {
  return api.get(`/clinic/doctors/${doctorId}/available-slots`, { params: { date, duration } });
}

export async function scheduleProcedureBooking(doctorId, data) {
  return api.post(`/clinic/doctors/${doctorId}/procedure-booking`, data);
}

export async function cancelProcedureBooking(bookingId) {
  return api.delete(`/clinic/bookings/${bookingId}/procedure`);
}

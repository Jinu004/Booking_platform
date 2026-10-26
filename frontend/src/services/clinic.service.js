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

// Today's live queue for tokens and appointments (one row per booking)
export async function getQueue() {
  return api.get('/clinic/queue');
}

// Appointment rows only (uses the booking id): status is 'arrived' or 'in_consult'. Token rows keep using updateTokenStatus.
export async function setAppointmentQueueStatus(bookingId, status) {
  return api.patch(`/bookings/${bookingId}/queue-status`, { status });
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

// Appointment mode: body { patient_name, phone, date (YYYY-MM-DD), start_time (HH:MM), notes? }
export async function scheduleAppointmentBooking(doctorId, data) {
  return api.post(`/clinic/doctors/${doctorId}/appointment-booking`, data);
}

export async function cancelProcedureBooking(bookingId) {
  return api.delete(`/clinic/bookings/${bookingId}/procedure`);
}

// Patient erasure (admin only). The id is the CUSTOMER id (customers.id), not the patient id.
// Preview: resolves to { success, data: { customer: { id, name, phone }, counts, patients: [{ id, name }] } }
export async function previewCustomerErasure(customerId) {
  return api.get(`/clinic/customers/${customerId}/erase-preview`);
}

// Erases the customer and everything linked to their phone number. Resolves to { success, data: { counts, keepMedicalNotes } }
export async function eraseCustomer(customerId, { keepMedicalNotes = false } = {}) {
  return api.post(`/clinic/customers/${customerId}/erase`, { confirm: 'DELETE', keepMedicalNotes: keepMedicalNotes === true });
}

import api from '../utils/api';

export async function getPatients(params) {
  return api.get('/customers', { params });
}

export async function getPatientById(id) {
  return api.get(`/customers/${id}`);
}

export async function getPatientHistory(id) {
  return api.get(`/customers/${id}/history`);
}

export async function updatePatient(id, data) {
  return api.patch(`/customers/${id}`, data);
}

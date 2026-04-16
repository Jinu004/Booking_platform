import api from '../utils/api';

export async function getPatients(params) {
  const res = await api.get('/customers', { params });
  return res.data;
}

export async function getPatientById(id) {
  const res = await api.get(`/customers/${id}`);
  return res.data;
}

export async function getPatientHistory(id) {
  const res = await api.get(`/customers/${id}/history`);
  return res.data;
}

export async function updatePatient(id, data) {
  const res = await api.patch(`/customers/${id}`, data);
  return res.data;
}

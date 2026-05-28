import api from '../utils/api';

export async function getLeads() {
  const res = await api.get('/leads');
  return res.data;
}

export async function updateLeadStatus(id, status) {
  const res = await api.patch(`/leads/${id}/status`, { status });
  return res.data;
}

import api from '../utils/api';

export async function getLeads() {
  const res = await api.get('/leads');
  return res.data;
}

export async function updateLeadStatus(id, status) {
  const res = await api.patch(`/leads/${id}/status`, { status });
  return res.data;
}

export async function updateOrderPayment(id, data) {
  const res = await api.patch(`/leads/${id}/payment`, data);
  return res.data;
}

export async function updateOrderNotes(id, data) {
  const res = await api.patch(`/leads/${id}/notes`, data);
  return res.data;
}

export async function updateOrderTracking(id, data) {
  const res = await api.patch(`/leads/${id}/tracking`, data);
  return res.data;
}

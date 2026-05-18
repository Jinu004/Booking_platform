import api from '../utils/api';

export async function getStaff() {
  const res = await api.get('/staff');
  return res.data;
}

export async function inviteStaff(data) {
  const res = await api.post('/staff', data);
  return res.data;
}

export async function updateStaff(id, data) {
  const res = await api.patch(`/staff/${id}`, data);
  return res.data;
}

export async function deleteStaff(id) {
  const res = await api.delete(`/staff/${id}`);
  return res.data;
}

export async function activateStaff(id) {
  const res = await api.patch(`/staff/${id}/activate`);
  return res.data;
}

export async function deleteStaffPermanently(id) {
  const res = await api.delete(`/staff/${id}/permanent`);
  return res.data;
}

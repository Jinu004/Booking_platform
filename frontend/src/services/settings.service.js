import api from '../utils/api';

export async function getSettings() {
  const res = await api.get('/settings');
  return res.data;
}

export async function updateSettings(data) {
  const res = await api.put('/settings', data);
  return res.data;
}

export async function getClinicSettings() {
  const res = await api.get('/settings/clinic');
  return res.data;
}

export async function updateClinicSettings(data) {
  const res = await api.put('/settings/clinic', data);
  return res.data;
}

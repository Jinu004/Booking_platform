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

export async function getHITLSettings() {
  const res = await api.get('/settings/hitl');
  return res.data;
}

export async function updateHITLSettings(data) {
  const res = await api.put('/settings/hitl', data);
  return res.data;
}

// Clinic answers (guided knowledge base): short answers, treatments, offers and questions the AI could not answer

// All 10 answer keys, each a string ("" = skipped)
export async function getAiFaq() {
  const res = await api.get('/settings/ai-faq');
  return res.data;
}

// Only the keys sent are changed; "" removes an answer. Returns all 10 keys.
export async function updateAiFaq(data) {
  const res = await api.put('/settings/ai-faq', data);
  return res.data;
}

export async function getTreatments() {
  const res = await api.get('/settings/treatments');
  return res.data;
}

export async function createTreatment(data) {
  const res = await api.post('/settings/treatments', data);
  return res.data;
}

export async function updateTreatment(id, data) {
  const res = await api.put(`/settings/treatments/${id}`, data);
  return res.data;
}

export async function deleteTreatment(id) {
  const res = await api.delete(`/settings/treatments/${id}`);
  return res.data;
}

export async function getOffers() {
  const res = await api.get('/settings/offers');
  return res.data;
}

export async function createOffer(data) {
  const res = await api.post('/settings/offers', data);
  return res.data;
}

export async function updateOffer(id, data) {
  const res = await api.put(`/settings/offers/${id}`, data);
  return res.data;
}

export async function deleteOffer(id) {
  const res = await api.delete(`/settings/offers/${id}`);
  return res.data;
}

export async function getUnansweredQuestions() {
  const res = await api.get('/settings/unanswered-questions');
  return res.data;
}

export async function resolveUnansweredQuestion(id) {
  const res = await api.patch(`/settings/unanswered-questions/${id}/resolve`);
  return res.data;
}

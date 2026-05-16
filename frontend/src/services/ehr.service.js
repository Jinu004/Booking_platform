import api from '../utils/api';

export const getEHRPatients = (search) => api.get('/ehr/patients', { params: { search } });
export const getEHRPatient = (customerId) => api.get(`/ehr/patients/${customerId}`);
export const upsertProfile = (customerId, data) => api.put(`/ehr/patients/${customerId}/profile`, data);
export const addCondition = (customerId, data) => api.post(`/ehr/patients/${customerId}/conditions`, data);
export const deleteCondition = (customerId, id) => api.delete(`/ehr/patients/${customerId}/conditions/${id}`);
export const addVisitNote = (customerId, data) => api.post(`/ehr/patients/${customerId}/visit-notes`, data);
export const updateVisitNote = (customerId, id, data) => api.put(`/ehr/patients/${customerId}/visit-notes/${id}`, data);

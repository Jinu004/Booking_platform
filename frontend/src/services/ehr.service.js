import api from '../utils/api';

export const getEHRPatients = (search) => api.get('/ehr/patients', { params: { search } });
export const getEHRPatient = (patientId) => api.get(`/ehr/patients/${patientId}`);
export const upsertProfile = (patientId, data) => api.put(`/ehr/patients/${patientId}/profile`, data);
export const addCondition = (patientId, data) => api.post(`/ehr/patients/${patientId}/conditions`, data);
export const deleteCondition = (patientId, id) => api.delete(`/ehr/patients/${patientId}/conditions/${id}`);
export const addVisitNote = (patientId, data) => api.post(`/ehr/patients/${patientId}/visit-notes`, data);
export const updateVisitNote = (patientId, id, data) => api.put(`/ehr/patients/${patientId}/visit-notes/${id}`, data);

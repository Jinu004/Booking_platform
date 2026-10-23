import api from '../utils/api';

export const getAllTenants = () => api.get('/superadmin/tenants');
export const getPlatformStats = () => api.get('/superadmin/stats');
export const updateTenantStatus = (id, status) => api.patch(`/superadmin/tenants/${id}/status`, { status });
export const updateTenant = (id, data) => api.patch(`/superadmin/tenants/${id}`, data);
export const createTenant = (data) => api.post('/superadmin/tenants', data);
// mode: 'token' or 'appointment'. 'appointment' also turns WhatsApp appointment booking on, 'token' turns it off. Returns { mode, ai_appointment_booking }
export const setTenantBookingMode = (id, mode) => api.post(`/superadmin/tenants/${id}/booking-mode`, { mode });
export const clearTenantConversations = (id) => api.delete(`/superadmin/tenants/${id}/conversations`);
import api from '../utils/api';

export const getAllTenants = () => api.get('/superadmin/tenants');
export const getPlatformStats = () => api.get('/superadmin/stats');
export const updateTenantStatus = (id, status) => api.patch(`/superadmin/tenants/${id}/status`, { status });
export const updateTenant = (id, data) => api.patch(`/superadmin/tenants/${id}`, data);
export const createTenant = (data) => api.post('/superadmin/tenants', data);
export const clearTenantConversations = (id) => api.delete(`/superadmin/tenants/${id}/conversations`);
export const getPlatformConfig = () => api.get('/superadmin/platform-config');
export const updatePlatformConfig = (key, value) => api.put('/superadmin/platform-config', { key, value });

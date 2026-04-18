import api from './api';

export const getAllTenants = () => {
  return api.get('/superadmin/tenants');
};

export const getPlatformStats = () => {
  return api.get('/superadmin/stats');
};

export const updateTenantStatus = (id, status) => {
  return api.patch(`/superadmin/tenants/${id}/status`, { status });
};

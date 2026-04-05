import axios from 'axios';
import useStore from '../store/useStore';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1',
  headers: {
    'Content-Type': 'application/json'
  }
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (import.meta.env.VITE_BYPASS_AUTH === 'true') {
      const devRole = localStorage.getItem('dev_role');
      const devTenantId = localStorage.getItem('dev_tenant_id');
      if (devRole) config.headers['x-dev-role'] = devRole;
      if (devTenantId) config.headers['x-dev-tenant-id'] = devTenantId;
    }
    
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    if (!error.response) {
      useStore.getState().addToast('Cannot connect to server', 'error');
      return Promise.reject({ success: false, data: null, error: 'Cannot connect to server' });
    }

    const { status } = error.response;

    if (status === 401) {
      localStorage.removeItem('auth_token');
      useStore.getState().logout();
      window.location.href = '/login';
    } else if (status === 403) {
      useStore.getState().addToast('You do not have permission', 'error');
    } else if (status === 500) {
      useStore.getState().addToast('Something went wrong. Try again.', 'error');
    }

    return Promise.reject(error.response.data);
  }
);

export default api;

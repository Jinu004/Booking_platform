import axios from 'axios';
import useStore from '../store/useStore';
import { clearBookingFormCache } from './bookingFormCache';

const GET_TIMEOUT_MS = 20000;
const LONG_GET_PATTERN = /\/superadmin\/tenants\/[^/]+\/(waba-info|send-readiness|templates)/;
const TIMEOUT_MESSAGE = 'The server took too long to respond. Check your connection and try again.';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1',
  headers: {
    'Content-Type': 'application/json'
  }
});

api.interceptors.request.use(
  async (config) => {
    if (import.meta.env.VITE_BYPASS_AUTH === 'true') {
      const devTenantId = import.meta.env.VITE_DEV_TENANT_ID || localStorage.getItem('dev_tenant_id');
      config.headers['x-dev-role'] = 'admin';
      if (devTenantId) config.headers['x-dev-tenant-id'] = devTenantId;
    } else {
      const token = localStorage.getItem('auth_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }

    // GET requests give up after 20 s (a hung request must not wait forever). Never for POST, PUT, PATCH or DELETE, and not for the
    // few GETs that can legitimately take long: file/image downloads (blob) and the super admin panels that call Meta one after another.
    if (String(config.method || 'get').toLowerCase() === 'get' && !config.timeout
        && config.responseType !== 'blob'
        && !LONG_GET_PATTERN.test(String(config.url || ''))) {
      config.timeout = GET_TIMEOUT_MS;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// A rejected login token: clear the stored login and go to the login page (also used by the live events client)
export function logoutUnauthorized() {
  const isAuthRoute = window.location.pathname === '/login' ||
                      window.location.pathname === '/reset-password';
  if (!isAuthRoute) {
    clearBookingFormCache();
    localStorage.removeItem('auth_token');
    localStorage.removeItem('staff_data');
    if (useStore.getState().clearAuth) {
      useStore.getState().clearAuth();
    }
    window.location.href = '/login';
  }
}

api.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    if (!error.response && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') && /timeout/i.test(String(error.message || ''))) {
      // A GET that timed out: a readable message for the page's error state (getErrorMessage / LoadError); never a logout
      useStore.getState().addToast(TIMEOUT_MESSAGE, 'error');
      return Promise.reject({ success: false, data: null, error: TIMEOUT_MESSAGE });
    }

    if (!error.response) {
      useStore.getState().addToast('Cannot connect to server', 'error');
      return Promise.reject({ success: false, data: null, error: 'Cannot connect to server' });
    }

    const { status } = error.response;

    if (status === 401) {
      logoutUnauthorized();
    } else if (status === 403) {
      // "Account inactive / suspended / pending approval" explain themselves; every other 403 keeps the generic text
      const serverText = error.response.data?.error;
      useStore.getState().addToast(typeof serverText === 'string' && serverText.startsWith('Account') ? serverText : 'You do not have permission', 'error');
    } else if (status === 500) {
      if (!error.config?.silent) {
        useStore.getState().addToast('Something went wrong. Try again.', 'error');
      }
    }

    return Promise.reject(error.response.data);
  }
);

export default api;

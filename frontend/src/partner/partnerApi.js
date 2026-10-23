// API client for the partner (promoter) portal. Separate from the staff client: its own token key,
// so a staff login and a partner login in the same browser never interfere.
import axios from 'axios';

export const PARTNER_TOKEN_KEY = 'partner_token';
export const PARTNER_DATA_KEY = 'partner_data';

const partnerApi = axios.create({
  baseURL: (import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1') + '/partner',
  headers: { 'Content-Type': 'application/json' }
});

export function getPartnerToken() {
  try { return localStorage.getItem(PARTNER_TOKEN_KEY); } catch { return null; }
}

export function setPartnerSession(token, promoter) {
  try {
    localStorage.setItem(PARTNER_TOKEN_KEY, token);
    localStorage.setItem(PARTNER_DATA_KEY, JSON.stringify(promoter));
  } catch { /* ignore */ }
}

export function clearPartnerSession() {
  try {
    localStorage.removeItem(PARTNER_TOKEN_KEY);
    localStorage.removeItem(PARTNER_DATA_KEY);
  } catch { /* ignore */ }
}

export function getStoredPartner() {
  try { return JSON.parse(localStorage.getItem(PARTNER_DATA_KEY) || 'null'); } catch { return null; }
}

partnerApi.interceptors.request.use((config) => {
  const token = getPartnerToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

partnerApi.interceptors.response.use(
  (response) => (response.config.responseType === 'blob' ? response : response.data),
  (error) => {
    if (!error.response) return Promise.reject({ success: false, error: 'Cannot connect to server' });
    const publicPaths = ['/partner/login', '/partner/apply', '/partner/reset-password', '/partner/forgot-password'];
    if (error.response.status === 401 && !publicPaths.includes(window.location.pathname)) {
      clearPartnerSession();
      window.location.href = '/partner/login';
    }
    return Promise.reject(error.response.data || { error: 'Request failed' });
  }
);

export default partnerApi;

// Super admin API calls for billing and the promoter program.
import api from '../utils/api';

const P = '/superadmin/promoter-program';
const B = '/superadmin/billing';

export const promoterAdmin = {
  overview: () => api.get(`${P}/overview`),
  audit: (params) => api.get(`${P}/audit`, { params }),
  ledger: (params) => api.get(`${P}/ledger`, { params }),

  settings: () => api.get(`${P}/settings`),
  settingsSchema: () => api.get(`${P}/settings/schema`),
  settingsHistory: () => api.get(`${P}/settings/history`),
  previewSettings: (changes) => api.post(`${P}/settings/preview`, { changes }),
  saveSettings: (body) => api.put(`${P}/settings`, body),

  schemes: () => api.get(`${P}/schemes`),
  scheme: (id) => api.get(`${P}/schemes/${id}`),
  createScheme: (body) => api.post(`${P}/schemes`, body),
  saveScheme: (id, body) => api.put(`${P}/schemes/${id}`, body),
  previewScheme: (id, body) => api.post(`${P}/schemes/${id}/preview`, body),

  promoters: (params) => api.get(`${P}/promoters`, { params }),
  createPromoter: (body) => api.post(`${P}/promoters`, body),
  promoter: (id) => api.get(`${P}/promoters/${id}`),
  promoterAction: (id, action, body) => api.post(`${P}/promoters/${id}/${action}`, body),
  promoterTerms: (id, body) => api.put(`${P}/promoters/${id}/terms`, body),
  reviewKyc: (id, body) => api.post(`${P}/promoters/${id}/kyc`, body),

  tenantReferral: (tenantId) => api.get(`${P}/tenants/${tenantId}/referral`),
  assignReferral: (tenantId, body) => api.post(`${P}/tenants/${tenantId}/referral`, body),
  referralStatus: (tenantId, body) => api.post(`${P}/tenants/${tenantId}/referral/status`, body),
  referralTerms: (tenantId, body) => api.post(`${P}/tenants/${tenantId}/referral/terms`, body),

  addAdjustment: (body) => api.post(`${P}/adjustments`, body),

  payouts: (params) => api.get(`${P}/payouts`, { params }),
  runPayouts: (body) => api.post(`${P}/payouts/run`, body),
  payout: (id) => api.get(`${P}/payouts/${id}`),
  payoutAction: (id, action, body) => api.post(`${P}/payouts/${id}/${action}`, body),
  payoutStatement: (id) => api.get(`${P}/payouts/${id}/statement.pdf`, { responseType: 'blob' }),
  payoutCsv: (params) => api.get(`${P}/payouts/export.csv`, { params, responseType: 'blob' }),
  runDailyJob: () => api.post(`${P}/jobs/release`),

  plans: () => api.get(`${B}/plans`),
  updatePlan: (id, body) => api.patch(`${B}/plans/${id}`, body),
  payments: (tenantId) => api.get(`${B}/tenants/${tenantId}/payments`),
  recordPayment: (tenantId, body) => api.post(`${B}/tenants/${tenantId}/payments`, body),
  refundPayment: (id, body) => api.post(`${B}/payments/${id}/refund`, body),
  voidPayment: (id, body) => api.post(`${B}/payments/${id}/void`, body)
};

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

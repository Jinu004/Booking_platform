import api from '../utils/api';

/**
 * Creates a new tenant
 * @param {object} data
 * @param {string} data.name
 * @param {string} data.industry
 * @param {string} data.whatsappNumber
 * @param {string} data.plan
 * @returns {Promise<object>} Created tenant
 */
export async function createTenant(data) {
  const res = await api.post('/tenants', data);
  return res.data;
}

/**
 * Gets tenant by ID
 * @param {string} id
 * @returns {Promise<object>} Tenant
 */
export async function getTenantById(id) {
  const res = await api.get(`/tenants/${id}`);
  return res.data;
}

/**
 * Gets all configs for tenant as flat object
 * @param {string} id
 * @returns {Promise<object>} Config key-value pairs
 */
export async function getTenantConfigs(id) {
  const res = await api.get(`/tenants/${id}/config`);
  return res.data;
}

/**
 * Updates a single config value
 * @param {string} id
 * @param {string} key
 * @param {string} value
 * @returns {Promise<object>} Updated config
 */
export async function updateTenantConfig(id, key, value) {
  const res = await api.post(`/tenants/${id}/config`, { key, value });
  return res.data;
}

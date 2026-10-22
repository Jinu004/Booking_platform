const pool = require('../../config/database');
const tenantModel = require('./tenant.model')
const redisClient = require('../../config/redis');
const logger = require('../../utils/logger');

const defaultConfigsMap = {
  clinic: {
    avg_consultation_minutes: '10',
    max_tokens_per_day: '50',
    reset_time: '06:00',
    language: 'english',
    weekly_off: 'sunday',
    booking_mode: 'token',
    reminder_24h: 'true',
    reminder_2h: 'false'
  },
  service_centre: {
    avg_service_hours: '4',
    language: 'english',
    weekly_off: 'sunday',
    booking_mode: 'appointment'
  },
  salon: {
    avg_service_minutes: '45',
    language: 'english',
    weekly_off: 'monday',
    booking_mode: 'appointment'
  },
  diagnostic_lab: {
    language: 'english',
    weekly_off: 'sunday',
    home_collection: 'true',
    booking_mode: 'appointment'
  },
  coaching: {
    language: 'english',
    weekly_off: 'sunday',
    booking_mode: 'appointment'
  },
  hotel: {
    language: 'english',
    booking_mode: 'appointment',
    check_in_time: '14:00',
    check_out_time: '11:00'
  }
};

/**
 * Normalizes WhatsApp number to +91XXXXXXXXXX
 */
const normalizeNumber = (num) => {
  let cleaned = num.replace(/[^\d+]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('91')) {
      cleaned = '+' + cleaned;
    } else if (cleaned.length === 10) {
      cleaned = '+91' + cleaned;
    }
  }
  return cleaned;
};

/**
 * True when the number is empty or a placeholder (+9100000000...), i.e. not a real clinic number
 */
const isPlaceholderWhatsappNumber = (num) => {
  const normalized = normalizeNumber(String(num ?? ''));
  return !normalized || normalized.startsWith('+9100000000');
};

const WHATSAPP_NUMBER_MANAGED_MESSAGE = 'WhatsApp number is managed by the Meta connection. Use Sync from Meta.';
const WHATSAPP_NUMBER_IN_USE_MESSAGE = 'This WhatsApp number is already used by another clinic';

/**
 * True when a tenant connected to Meta (it has a phone number id) is asked to change its WhatsApp number.
 * A value equal to the stored one (after normalizing) is not a change.
 * @param {object} tenantRow - needs whatsapp_number and whatsapp_phone_number_id
 * @param {*} incoming - the number from the request
 */
const isManagedNumberChange = (tenantRow, incoming) => {
  if (!tenantRow || !tenantRow.whatsapp_phone_number_id) return false;
  const stored = tenantRow.whatsapp_number ? normalizeNumber(String(tenantRow.whatsapp_number)) : '';
  return normalizeNumber(String(incoming ?? '')) !== stored;
};

/**
 * Creates a new tenant with default configs
 */
const createTenant = async (tenantData) => {
  const { clinicName, email, password, industry: rawIndustry, whatsappNumber, plan } = tenantData;
  const name = clinicName || tenantData.name;
  const industry = rawIndustry || 'clinic';
  const normalizedNumber = whatsappNumber ? normalizeNumber(whatsappNumber) : null;
  if (normalizedNumber) {
    const exists = await tenantModel.whatsappNumberExists(pool, normalizedNumber);
    if (exists) throw new Error('WhatsApp number is already registered');
  }

  let baseSlug = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, '-');
  let slug = baseSlug;

  while (await tenantModel.slugExists(pool, slug)) {
    const random4 = Math.floor(1000 + Math.random() * 9000);
    slug = `${baseSlug}-${random4}`;
  }

  const finalPlan = plan || 'starter';

  const tenant = await tenantModel.createTenant(pool, {
    name,
    slug,
    industry,
    plan: finalPlan,
    whatsapp_number: normalizedNumber || null
  });

  await setDefaultConfigs(tenant.id, industry);

  // Auto-insert default row for tenant_settings
  await pool.query(
    'INSERT INTO tenant_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING',
    [tenant.id]
  );

  if (email && password) {
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO staff (tenant_id, name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, 'admin', true)`,
      [tenant.id, name, email, hashedPassword]
    );
  }

  const configs = await getAllConfigs(tenant.id);
  return { ...tenant, configs };
};

/**
 * Gets tenant by ID, throws if not found
 */
const getTenantById = async (id) => {
  const tenant = await tenantModel.getTenantById(pool, id);
  if (!tenant) throw new Error('Tenant not found');
  return tenant;
};

/**
 * Gets tenant by WhatsApp number for webhook identification
 */
const getTenantByWhatsapp = async (number) => {
  const normalizedNumber = normalizeNumber(number);
  const cacheKey = `tenant_wa:${normalizedNumber}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch {}
  const tenant = await tenantModel.getTenantByWhatsapp(pool, normalizedNumber);
  if (tenant) {
    try { await redisClient.setEx(cacheKey, 300, JSON.stringify(tenant)); } catch {}
  }
  return tenant;
};

/**
 * Gets tenant by the Meta phone number id of a webhook (metadata.phone_number_id). Not cached: one indexed query,
 * and the clinic's status and connection are always current.
 */
const getTenantByPhoneNumberId = async (phoneNumberId) => {
  if (!phoneNumberId || !/^\d{8,20}$/.test(String(phoneNumberId))) return null;
  return tenantModel.getTenantByPhoneNumberId(pool, String(phoneNumberId));
};

/**
 * Updates tenant fields
 * Prevents changing industry or slug
 */
const updateTenant = async (id, updateData) => {
  const safeData = { ...updateData };
  delete safeData.industry;
  delete safeData.slug;

  // The route sends whatsapp_number; whatsappNumber is still accepted from other callers
  const hasNumber = safeData.whatsapp_number !== undefined || safeData.whatsappNumber !== undefined;
  let oldNumber = null;
  if (hasNumber) {
    const incoming = safeData.whatsapp_number !== undefined ? safeData.whatsapp_number : safeData.whatsappNumber;
    delete safeData.whatsappNumber;
    const oldTenant = await tenantModel.getTenantById(pool, id);
    oldNumber = oldTenant?.whatsapp_number || null;
    if (isManagedNumberChange(oldTenant, incoming)) {
      const err = new Error(WHATSAPP_NUMBER_MANAGED_MESSAGE);
      err.status = 409;
      throw err;
    }
    if (oldTenant?.whatsapp_phone_number_id) {
      // Connected tenant and an unchanged value: ignored
      delete safeData.whatsapp_number;
    } else if (incoming) {
      safeData.whatsapp_number = normalizeNumber(String(incoming));
    }
  }

  if (Object.keys(safeData).length === 0) {
     return getTenantById(id);
  }

  const updated = await tenantModel.updateTenant(pool, id, safeData);
  if (hasNumber) {
    // The webhook caches the tenant by number: drop the old and the new key
    try {
      if (oldNumber) await redisClient.del(`tenant_wa:${normalizeNumber(String(oldNumber))}`);
      if (updated?.whatsapp_number) await redisClient.del(`tenant_wa:${normalizeNumber(String(updated.whatsapp_number))}`);
    } catch {}
  }
  return updated;
};

/**
 * Sets a single config value
 */
const setConfig = async (tenantId, key, value) => {
  const result = await tenantModel.setTenantConfig(pool, tenantId, key, String(value));
  try {
    await redisClient.del(`tenant_configs:${tenantId}`);
  } catch (err) {
    logger.warn('Redis cache invalidation failed after setConfig:', err.message);
  }
  return result;
};

/**
 * Gets all configs as a key-value object
 */
const getAllConfigs = async (tenantId) => {
  const cacheKey = `tenant_configs:${tenantId}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (err) {
    logger.warn('Redis get failed for tenant configs:', err.message);
  }
  const configRows = await tenantModel.getTenantConfigs(pool, tenantId);
  const configs = {};
  for (const row of configRows) {
    configs[row.key] = row.value;
  }
  try {
    await redisClient.setEx(cacheKey, 60, JSON.stringify(configs));
  } catch (err) {
    logger.warn('Redis set failed for tenant configs:', err.message);
  }
  return configs;
};

/**
 * Gets single config value
 */
const getConfig = async (tenantId, key) => {
  return await tenantModel.getTenantConfigByKey(pool, tenantId, key);
};

/**
 * Sets all default configs for an industry
 */
const setDefaultConfigs = async (tenantId, industry) => {
  const defaults = defaultConfigsMap[industry];
  if (!defaults) {
    logger.warn(`Unknown industry '${industry}' provided for tenant ${tenantId}. No default configs set.`);
    return;
  }

  for (const [key, value] of Object.entries(defaults)) {
    await setConfig(tenantId, key, value);
  }
};

module.exports = {
  createTenant,
  getTenantById,
  getTenantByWhatsapp,
  getTenantByPhoneNumberId,
  updateTenant,
  setConfig,
  getAllConfigs,
  getConfig,
  setDefaultConfigs,
  normalizeNumber,
  isPlaceholderWhatsappNumber,
  isManagedNumberChange,
  WHATSAPP_NUMBER_MANAGED_MESSAGE,
  WHATSAPP_NUMBER_IN_USE_MESSAGE
};

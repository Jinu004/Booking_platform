const pool = require('../../config/database');
const tenantModel = require('./tenant.model');
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
 * Creates a new tenant with default configs
 */
const createTenant = async ({ name, industry, whatsappNumber, plan }) => {
  const normalizedNumber = normalizeNumber(whatsappNumber);
  
  const exists = await tenantModel.whatsappNumberExists(pool, normalizedNumber);
  if (exists) {
    throw new Error('WhatsApp number is already registered');
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
    whatsapp_number: normalizedNumber
  });

  await setDefaultConfigs(tenant.id, industry);

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
  return await tenantModel.getTenantByWhatsapp(pool, normalizedNumber);
};

/**
 * Updates tenant fields
 * Prevents changing industry or slug
 */
const updateTenant = async (id, updateData) => {
  const safeData = { ...updateData };
  delete safeData.industry;
  delete safeData.slug;

  if (safeData.whatsappNumber) {
    safeData.whatsapp_number = normalizeNumber(safeData.whatsappNumber);
    delete safeData.whatsappNumber;
  }

  if (Object.keys(safeData).length === 0) {
     return getTenantById(id);
  }

  return await tenantModel.updateTenant(pool, id, safeData);
};

/**
 * Sets a single config value
 */
const setConfig = async (tenantId, key, value) => {
  return await tenantModel.setTenantConfig(pool, tenantId, key, String(value));
};

/**
 * Gets all configs as a key-value object
 */
const getAllConfigs = async (tenantId) => {
  const configRows = await tenantModel.getTenantConfigs(pool, tenantId);
  const configs = {};
  for (const row of configRows) {
    configs[row.key] = row.value;
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
  updateTenant,
  setConfig,
  getAllConfigs,
  getConfig,
  setDefaultConfigs
};

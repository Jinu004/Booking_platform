const pool = require('../../config/database');
const CRMModel = require('./crm.model');
const logger = require('../../utils/logger');

/**
 * Finds or creates customer from incoming message
 * Called by conversation service on every message
 *
 * @param {string} tenantId
 * @param {string} phoneNumber
 * @param {string} name - optional, from WhatsApp profile
 * @returns {Promise<object>} Customer record
 */
async function findOrCreateCustomer(tenantId, phoneNumber, name) {
  try {
    const customer = await CRMModel.upsertCustomer(pool, tenantId, {
      phone: phoneNumber,
      name: name || undefined
    });
    return customer;
  } catch (error) {
    logger.error(`Error in findOrCreateCustomer: ${error.message}`);
    throw error;
  }
}

/**
 * Gets full customer profile with history
 *
 * @param {string} tenantId
 * @param {string} customerId
 * @returns {Promise<object>} Customer + bookings history
 */
async function getCustomerProfile(tenantId, customerId) {
  const customer = await CRMModel.getCustomerById(pool, tenantId, customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }
  const history = await CRMModel.getCustomerHistory(pool, tenantId, customerId);
  return { ...customer, history };
}

/**
 * Searches customers by name or phone
 */
async function searchCustomers(tenantId, options) {
  return await CRMModel.getCustomers(pool, tenantId, options);
}

module.exports = {
  findOrCreateCustomer,
  getCustomerProfile,
  searchCustomers
};

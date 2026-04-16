const express = require('express');
const { identifyTenant } = require('../tenant/tenant.middleware');
const {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  getCustomerHistory
} = require('./crm.controller');

const router = express.Router();

router.use(identifyTenant);

router.get('/', getCustomers);
router.post('/', createCustomer);
router.get('/:id', getCustomerById);
router.patch('/:id', updateCustomer);
router.get('/:id/history', getCustomerHistory);

module.exports = router;

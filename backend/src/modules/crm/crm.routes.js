const express = require('express');
const { requireAuth, loadTenant } = require('../auth/auth.middleware');
const {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  getCustomerHistory,
  globalSearch
} = require('./crm.controller');

const router = express.Router();

router.use(requireAuth);
router.use(loadTenant);

router.get('/', getCustomers);
router.post('/', createCustomer);
router.get('/search', globalSearch);
router.get('/:id', getCustomerById);
router.patch('/:id', updateCustomer);
router.get('/:id/history', getCustomerHistory);

module.exports = router;

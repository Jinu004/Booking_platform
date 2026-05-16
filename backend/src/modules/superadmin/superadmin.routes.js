const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const {
  getAllTenants,
  getTenantDetails,
  updateTenantStatus,
  updateTenant,
  createTenant,
  getPlatformStats
} = require('./superadmin.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/tenants', getAllTenants);
router.post('/tenants', createTenant);
router.get('/tenants/:id', getTenantDetails);
router.patch('/tenants/:id/status', updateTenantStatus);
router.patch('/tenants/:id', updateTenant);
router.get('/stats', getPlatformStats);

module.exports = router;

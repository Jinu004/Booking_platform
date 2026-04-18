const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { 
  getAllTenants, 
  getTenantDetails, 
  updateTenantStatus, 
  getPlatformStats 
} = require('./superadmin.controller');

const router = express.Router();

// All child routes require auth and super_admin role
router.use(requireAuth);
router.use(requireRole('super_admin'));

router.get('/tenants', getAllTenants);
router.get('/tenants/:id', getTenantDetails);
router.patch('/tenants/:id/status', updateTenantStatus);
router.get('/stats', getPlatformStats);

module.exports = router;

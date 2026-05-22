const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const {
  getAllTenants,
  getTenantDetails,
  updateTenantStatus,
  updateTenant,
  createTenant,
  getPlatformStats,
  clearTenantConversations,
  deleteTenant
} = require('./superadmin.controller');

const router = express.Router();

router.use(requireAuth);
router.use(requireRole('super_admin'));

router.get('/tenants', getAllTenants);
router.post('/tenants', createTenant);
router.get('/tenants/:id', getTenantDetails);
router.patch('/tenants/:id/status', updateTenantStatus);
router.patch('/tenants/:id', updateTenant);
router.delete('/tenants/:id', deleteTenant);
router.get('/stats', getPlatformStats);
router.delete('/tenants/:id/conversations', clearTenantConversations);

module.exports = router;

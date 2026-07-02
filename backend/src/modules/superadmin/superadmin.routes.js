const express = require('express');
const pool = require('../../config/database');
const logger = require('../../utils/logger');
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
const { getConfig, updateConfig } = require('./platform-config.controller');

const router = express.Router();

router.use(requireAuth);
router.use(requireRole('super_admin'));

router.get('/tenants', getAllTenants);
router.post('/tenants', createTenant);
router.get('/tenants/:id', getTenantDetails);
router.patch('/tenants/:id/status', updateTenantStatus);
router.patch('/tenants/:id/config', async (req, res) => {
  try {
    const { key, value } = req.body
    if (!key) return res.status(400).json({ error: 'key is required' })
    await pool.query(
      'INSERT INTO tenant_configs (tenant_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, key) DO UPDATE SET value = $3',
      [req.params.id, key, String(value)]
    )
    return res.json({ success: true, key, value })
  } catch (err) {
    logger.error('SuperAdmin config update failed:', err.message)
    return res.status(500).json({ error: 'Failed to update config' })
  }
})
router.patch('/tenants/:id', updateTenant);
router.delete('/tenants/:id', deleteTenant);
router.get('/stats', getPlatformStats);
router.delete('/tenants/:id/conversations', clearTenantConversations);

router.get('/platform-config', getConfig);
router.put('/platform-config', updateConfig);

module.exports = router;

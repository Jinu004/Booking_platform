const express = require('express');
const { validationResult } = require('express-validator');
const { validationErrorResponse } = require('../../utils/response');
const {
  createTenant,
  getTenantById,
  getTenantBySlug,
  updateTenant,
  setConfig,
  getAllConfigs
} = require('./tenant.controller');
const {
  validateCreateTenant,
  validateUpdateTenant,
  validateSetConfig
} = require('./tenant.validation');

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return validationErrorResponse(res, errors.array());
  }
  next();
};

router.post('/', validateCreateTenant, validate, createTenant);
router.get('/slug/:slug', getTenantBySlug);
router.get('/:id', getTenantById);
router.put('/:id', validateUpdateTenant, validate, updateTenant);
router.post('/:id/config', validateSetConfig, validate, setConfig);
router.get('/:id/config', getAllConfigs);

module.exports = router;

const express = require('express');
const multer = require('multer');
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
const { submitPosterRequest } = require('./poster.controller');
const {
  validateCreateTenant,
  validateUpdateTenant,
  validateSetConfig
} = require('./tenant.validation');
const { requireAuth, requireRole } = require('../auth/auth.middleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG and WebP images are allowed'));
    }
  }
});

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return validationErrorResponse(res, errors.array());
  }
  next();
};

// All tenant routes require authentication
router.use(requireAuth);

router.post('/', requireRole('super_admin'), validateCreateTenant, validate, createTenant);
router.get('/slug/:slug', getTenantBySlug);
router.get('/:id', getTenantById);
router.put('/:id', validateUpdateTenant, validate, updateTenant);
router.post('/:id/config', validateSetConfig, validate, setConfig);
router.get('/:id/config', getAllConfigs);
router.post('/:id/poster-request', requireRole('admin', 'manager'), upload.single('poster'), submitPosterRequest);

module.exports = router;

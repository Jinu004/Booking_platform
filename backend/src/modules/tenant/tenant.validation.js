const { body, param } = require('express-validator');

const allowedIndustries = ['clinic', 'service_centre', 'salon', 'diagnostic_lab', 'coaching', 'hotel'];
const allowedPlans = ['starter', 'growth', 'pro'];
const allowedStatuses = ['active', 'inactive', 'suspended'];
const indianMobileRegex = /^(?:\+?91|0)?[6-9]\d{9}$/;

const validateCreateTenant = [
  body('name')
    .exists({ checkFalsy: true }).withMessage('Name is required')
    .isString().withMessage('Name must be a string')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters')
    .trim(),
    
  body('industry')
    .exists({ checkFalsy: true }).withMessage('Industry is required')
    .isIn(allowedIndustries).withMessage(`Industry must be one of: ${allowedIndustries.join(', ')}`),
    
  body('whatsappNumber')
    .exists({ checkFalsy: true }).withMessage('WhatsApp number is required')
    .matches(indianMobileRegex).withMessage('Must be a valid Indian mobile number'),
    
  body('plan')
    .optional()
    .isIn(allowedPlans).withMessage(`Plan must be one of: ${allowedPlans.join(', ')}`)
];

const validateUpdateTenant = [
  param('id').isUUID().withMessage('Invalid tenant ID format'),
  
  body('name')
    .optional()
    .isString().withMessage('Name must be a string')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters')
    .trim(),
    
  body('whatsappNumber')
    .optional()
    .matches(indianMobileRegex).withMessage('Must be a valid Indian mobile number'),
    
  body('plan')
    .optional()
    .isIn(allowedPlans).withMessage(`Plan must be one of: ${allowedPlans.join(', ')}`),
    
  body('status')
    .optional()
    .isIn(allowedStatuses).withMessage(`Status must be one of: ${allowedStatuses.join(', ')}`)
];

const validateSetConfig = [
  param('id').isUUID().withMessage('Invalid tenant ID format'),
  body('key')
    .exists({ checkFalsy: true }).withMessage('Key is required')
    .isString().withMessage('Key must be a string')
    .not().contains(' ').withMessage('Key cannot contain spaces')
    .toLowerCase(),
  body('value')
    .exists({ checkFalsy: true }).withMessage('Value is required')
    .isString().withMessage('Value must be a string')
];

module.exports = {
  validateCreateTenant,
  validateUpdateTenant,
  validateSetConfig
};

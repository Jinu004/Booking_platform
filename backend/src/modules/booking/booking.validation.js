const { body, param } = require('express-validator');
const pool = require('../../config/database');

const validateCreateBooking = [
  body('customerId')
    .notEmpty().withMessage('Customer ID is required')
    .isUUID().withMessage('Customer ID must be a valid UUID'),
    
  body('doctorId')
    .notEmpty().withMessage('Doctor ID is required')
    .isUUID().withMessage('Doctor ID must be a valid UUID'),
    
  body('bookingDate')
    .notEmpty().withMessage('Booking date is required')
    .isISO8601().withMessage('Booking date must be a valid date (YYYY-MM-DD)')
    .custom(async (value, { req }) => {
      const selectedDate = new Date(value);
      selectedDate.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (selectedDate < today) {
        throw new Error('Booking date must not be in the past');
      }

      // Check weekly off day (simple implementation, assuming tenantId is on req.tenant)
      const tenantId = req.tenant?.id;
      if (tenantId) {
        const result = await pool.query(
          'SELECT weekly_off FROM clinic_profiles WHERE tenant_id = $1 LIMIT 1', 
          [tenantId]
        );
        if (result.rows.length > 0) {
          const offDay = result.rows[0].weekly_off; // e.g. "Sunday"
          const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          if (days[selectedDate.getDay()] === offDay) {
            throw new Error(`Cannot book on ${offDay} as it is the weekly off day`);
          }
        }
      }
      return true;
    }),

  body('source')
    .optional()
    .isIn(['whatsapp', 'walkin', 'phone', 'web']).withMessage('Invalid source')
    .default('walkin'),

  body('notes')
    .optional()
    .isString().withMessage('Notes must be a string')
    .isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters')
];

const validateUpdateStatus = [
  param('id')
    .isUUID().withMessage('Booking ID must be a valid UUID'),
  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn(['pending', 'confirmed', 'cancelled', 'completed', 'noshow'])
    .withMessage('Invalid status')
];

module.exports = {
  validateCreateBooking,
  validateUpdateStatus
};

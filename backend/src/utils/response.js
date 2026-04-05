/**
 * Sends a successful API response
 *
 * @param {object} res - Express response object
 * @param {any} data - Response payload data
 * @param {number} statusCode - HTTP status code (default 200)
 */
const successResponse = (res, data, statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    data: data,
    error: null
  });
};

/**
 * Sends an error API response
 *
 * @param {object} res - Express response object
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default 500)
 */
const errorResponse = (res, message, statusCode = 500) => {
  return res.status(statusCode).json({
    success: false,
    data: null,
    error: message
  });
};

/**
 * Sends a validation error response
 *
 * @param {object} res - Express response object
 * @param {Array} errors - Array of validation errors
 */
const validationErrorResponse = (res, errors) => {
  return res.status(400).json({
    success: false,
    data: null,
    error: 'Validation failed',
    details: errors
  });
};

module.exports = {
  successResponse,
  errorResponse,
  validationErrorResponse
};

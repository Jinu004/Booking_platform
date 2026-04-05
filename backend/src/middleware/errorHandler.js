const logger = require('../utils/logger');
const { errorResponse } = require('../utils/response');
const env = require('../config/env');

/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });

  // Default to 500 for generic server errors
  const statusCode = err.statusCode || 500;
  
  // Do not send exact error stack/message in production to clients for security
  const message = env.NODE_ENV === 'production' && statusCode === 500 
    ? 'Internal Server Error' 
    : err.message;

  return errorResponse(res, message, statusCode);
};

module.exports = errorHandler;

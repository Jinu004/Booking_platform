const logger = require('../utils/logger');
const { errorResponse } = require('../utils/response');
const env = require('../config/env');

/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });

  // Upload problems are the sender's, not the server's: clear 400 answers (the poster upload is the only multer route)
  if (err && err.code === 'INVALID_FILE_TYPE') {
    return errorResponse(res, 'Only JPEG, PNG or WebP images are allowed', 400);
  }
  if (err && err.name === 'MulterError') {
    return errorResponse(res, err.code === 'LIMIT_FILE_SIZE' ? 'File too large, maximum 5 MB' : 'Upload failed, please try again', 400);
  }

  // Default to 500 for generic server errors
  const statusCode = err.statusCode || 500;
  
  // Do not send exact error stack/message in production to clients for security
  const message = env.NODE_ENV === 'production' && statusCode === 500 
    ? 'Internal Server Error' 
    : err.message;

  return errorResponse(res, message, statusCode);
};

module.exports = errorHandler;

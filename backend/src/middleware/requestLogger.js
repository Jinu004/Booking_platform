const logger = require('../utils/logger');

/**
 * Request logger middleware
 */
const requestLogger = (req, res, next) => {
  // Skip logging health checks to avoid noise
  if (req.path === '/health') {
    return next();
  }

  const start = Date.now();

  res.on('finish', () => {
    const elapsed = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} | Status: ${res.statusCode} | Time: ${elapsed}ms`);
  });

  next();
};

module.exports = requestLogger;

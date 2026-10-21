const logger = require('../utils/logger');

// Query parameter names whose presence is not even logged
const HIDDEN_QUERY_NAMES = new Set(['token', 'access_token', 'password', 'secret', 'key', 'authorization', 'code']);

/**
 * Request logger middleware.
 * Logs the method, the path (never the query string: it can hold phone numbers or the events token), only the NAMES of the
 * query parameters, the status and the time. Long digit runs in the path (a phone number used as a path segment) are hidden.
 */
const requestLogger = (req, res, next) => {
  // Skip logging health checks to avoid noise
  if (req.path === '/health') {
    return next();
  }

  const start = Date.now();

  res.on('finish', () => {
    const elapsed = Date.now() - start;
    const path = String(req.originalUrl || '').split('?')[0].replace(/\d{10,}/g, '[number]');
    const names = Object.keys(req.query || {})
      .filter(name => /^[A-Za-z0-9_.-]{1,40}$/.test(name) && !HIDDEN_QUERY_NAMES.has(name.toLowerCase()))
      .slice(0, 10);
    const query = names.length ? ` | query: ${names.join(',')}` : '';
    logger.info(`${req.method} ${path}${query} | Status: ${res.statusCode} | Time: ${elapsed}ms`);
  });

  next();
};

module.exports = requestLogger;

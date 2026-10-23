const logger = require('./logger');

/**
 * Wraps an async route handler: the handler returns data (sent with successResponse shape) or throws.
 * Errors with a numeric `status` (4xx) are sent to the client with their message and `details`;
 * anything else is logged and returned as a generic 500.
 */
function route(handler, { status: okStatus = 200 } = {}) {
  return async (req, res) => {
    try {
      const data = await handler(req, res);
      if (res.headersSent) return;
      return res.status(okStatus).json({ success: true, data: data === undefined ? null : data, error: null });
    } catch (err) {
      if (res.headersSent) return;
      if (err.code === '22P02') return res.status(400).json({ success: false, data: null, error: 'Invalid id or value' });
      const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
      if (status === 500) {
        logger.error(`${req.method} ${req.baseUrl}${req.route?.path || ''} failed: ${err.message}`);
        return res.status(500).json({ success: false, data: null, error: 'Something went wrong' });
      }
      const body = { success: false, data: null, error: err.message };
      if (err.details) body.details = err.details;
      return res.status(status).json(body);
    }
  };
}

function httpError(message, status = 400, details = null) {
  const e = new Error(message);
  e.status = status;
  if (details) e.details = details;
  return e;
}

module.exports = { route, httpError };

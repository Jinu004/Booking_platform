const rateLimit = require('express-rate-limit')
const logger = require('../utils/logger')

/**
 * General API rate limiter
 * Applies to all /api routes
 * 3000 requests per 15 minutes per IP
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  message: {
    success: false,
    data: null,
    error: 'Too many requests. Please try again later.'
  },
  handler: (req, res, next, options) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`)
    res.status(429).json(options.message)
  },
  standardHeaders: true,
  legacyHeaders: false
})

/**
 * Webhook rate limiter
 * Loop guard only: just validly signed requests reach it
 * 20000 requests per 15 minutes per IP
 */
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20000,
  message: {
    success: false,
    data: null,
    error: 'Too many webhook requests.'
  },
  standardHeaders: true,
  legacyHeaders: false
})

/**
 * Strict limiter for auth routes
 * Prevents brute force attacks
 * 10 requests per 15 minutes per IP
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    data: null,
    error: 'Too many auth attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
})

/**
 * Login limiter (own counter, separate from authLimiter)
 * Only failed attempts (status 400 and above) count
 * 20 failed attempts per 15 minutes per IP
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    data: null,
    error: 'Too many login attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
})

module.exports = {
  apiLimiter,
  webhookLimiter,
  authLimiter,
  loginLimiter
}

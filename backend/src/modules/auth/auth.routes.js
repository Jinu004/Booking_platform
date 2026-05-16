const express = require('express')
const router = express.Router()
const {
  login, logout, getMe,
  forgotPassword, resetPassword
} = require('./auth.controller')
const { requireAuth } = require('./auth.middleware')
const { authLimiter } = require('../../middleware/rateLimiter')

// Public routes — no auth needed
router.post('/login', authLimiter, login)
router.post('/forgot-password', authLimiter, forgotPassword)
router.post('/reset-password', authLimiter, resetPassword)

// Protected routes — auth required
router.post('/logout', requireAuth, logout)
router.get('/me', requireAuth, getMe)

module.exports = router

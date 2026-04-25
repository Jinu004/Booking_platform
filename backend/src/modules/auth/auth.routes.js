const express = require('express')
const router = express.Router()
const {
  login, logout, getMe,
  forgotPassword, resetPassword
} = require('./auth.controller')
const { requireAuth } = require('./auth.middleware')

// Public routes — no auth needed
router.post('/login', login)
router.post('/forgot-password', forgotPassword)
router.post('/reset-password', resetPassword)

// Protected routes — auth required
router.post('/logout', requireAuth, logout)
router.get('/me', requireAuth, getMe)

module.exports = router

const express = require('express')
const { requireAuth, loadTenant } = require('./auth.middleware')
const { getMe, verifyToken, getPermissions } = require('./auth.controller')

const router = express.Router()

// All routes require auth
router.use(requireAuth)
router.use(loadTenant)

router.get('/me', getMe)
router.post('/verify', verifyToken)
router.get('/permissions', getPermissions)

module.exports = router

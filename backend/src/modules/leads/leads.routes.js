const express = require('express')
const { requireAuth } = require('../auth/auth.middleware')
const { listLeads, createLead, updateLeadStatus } = require('./leads.controller')

const router = express.Router()
router.use(requireAuth)

router.get('/', listLeads)
router.post('/', createLead)
router.patch('/:id/status', updateLeadStatus)

module.exports = router

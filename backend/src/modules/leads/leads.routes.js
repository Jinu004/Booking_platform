const express = require('express')
const { requireAuth } = require('../auth/auth.middleware')
const { listLeads, createLead, updateLeadStatus, updateOrderPayment, updateOrderNotes, updateOrderTracking } = require('./leads.controller')

const router = express.Router()
router.use(requireAuth)

router.get('/', listLeads)
router.post('/', createLead)
router.patch('/:id/status', updateLeadStatus)

router.patch('/:id/payment', updateOrderPayment)
router.patch('/:id/notes', updateOrderNotes)
router.patch('/:id/tracking', updateOrderTracking)

module.exports = router

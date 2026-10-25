const express = require('express')
const { requireAuth, requireRole } = require('../auth/auth.middleware')
const {
  getSettings,
  updateSettings,
  getClinicSettings,
  updateClinicSettings,
  getHITLSettings,
  updateHITLSettings
} = require('./settings.controller')
const {
  getAiFaq,
  putAiFaq,
  listTreatments,
  createTreatment,
  updateTreatment,
  deleteTreatment,
  listOffers,
  createOffer,
  updateOffer,
  deleteOffer,
  listUnansweredQuestions,
  resolveUnansweredQuestion
} = require('./aiFaq.controller')

const router = express.Router()
router.use(requireAuth)

router.get('/', getSettings)
router.put('/', requireRole('admin', 'manager'), updateSettings)
router.get('/clinic', getClinicSettings)
router.put('/clinic', requireRole('admin', 'manager'), updateClinicSettings)
router.get('/hitl', getHITLSettings)
router.put('/hitl', requireRole('admin', 'manager'), updateHITLSettings)

// Guided clinic knowledge base (migration 045). Admin or manager only, reads included; writes also need the growth or pro plan (checked in the controller).
const adminOrManager = requireRole('admin', 'manager')
router.get('/ai-faq', adminOrManager, getAiFaq)
router.put('/ai-faq', adminOrManager, putAiFaq)
router.get('/treatments', adminOrManager, listTreatments)
router.post('/treatments', adminOrManager, createTreatment)
router.put('/treatments/:id', adminOrManager, updateTreatment)
router.delete('/treatments/:id', adminOrManager, deleteTreatment)
router.get('/offers', adminOrManager, listOffers)
router.post('/offers', adminOrManager, createOffer)
router.put('/offers/:id', adminOrManager, updateOffer)
router.delete('/offers/:id', adminOrManager, deleteOffer)
router.get('/unanswered-questions', adminOrManager, listUnansweredQuestions)
router.patch('/unanswered-questions/:id/resolve', adminOrManager, resolveUnansweredQuestion)

module.exports = router

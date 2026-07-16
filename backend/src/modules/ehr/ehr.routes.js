const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const {
  getPatients,
  getPatient,
  createPatient,
  upsertProfile,
  addCondition,
  deleteCondition,
  addVisitNote,
  updateVisitNote
} = require('./ehr.controller');
const { downloadPrescription, sendPrescriptionToWhatsApp } = require('./prescription.controller');

const router = express.Router();
router.use(requireAuth);

router.get('/patients', getPatients);
router.post('/patients', requireAuth, createPatient);
router.get('/patients/:patientId', getPatient);
router.put('/patients/:patientId/profile', requireRole('admin', 'manager', 'receptionist'), upsertProfile);
router.post('/patients/:patientId/conditions', requireRole('admin', 'manager', 'doctor'), addCondition);
router.delete('/patients/:patientId/conditions/:id', requireRole('admin', 'manager', 'doctor'), deleteCondition);
router.post('/patients/:patientId/visit-notes', requireRole('admin', 'manager', 'doctor'), addVisitNote);
router.put('/patients/:patientId/visit-notes/:id', requireRole('admin', 'manager', 'doctor'), updateVisitNote);

router.get('/patients/:patientId/visit-notes/:noteId/prescription', requireRole('admin', 'manager', 'doctor'), downloadPrescription);
router.post('/patients/:patientId/visit-notes/:noteId/prescription/send', requireRole('admin', 'manager', 'doctor'), sendPrescriptionToWhatsApp);

module.exports = router;

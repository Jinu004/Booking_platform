const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
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
router.put('/patients/:patientId/profile', upsertProfile);
router.post('/patients/:patientId/conditions', addCondition);
router.delete('/patients/:patientId/conditions/:id', deleteCondition);
router.post('/patients/:patientId/visit-notes', addVisitNote);
router.put('/patients/:patientId/visit-notes/:id', updateVisitNote);

router.get('/patients/:patientId/visit-notes/:noteId/prescription', downloadPrescription);
router.post('/patients/:patientId/visit-notes/:noteId/prescription/send', sendPrescriptionToWhatsApp);

module.exports = router;

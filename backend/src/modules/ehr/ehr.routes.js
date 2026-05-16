const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const {
  getPatients,
  getPatient,
  upsertProfile,
  addCondition,
  deleteCondition,
  addVisitNote,
  updateVisitNote
} = require('./ehr.controller');

const router = express.Router();
router.use(requireAuth);

router.get('/patients', getPatients);
router.get('/patients/:customerId', getPatient);
router.put('/patients/:customerId/profile', upsertProfile);
router.post('/patients/:customerId/conditions', addCondition);
router.delete('/patients/:customerId/conditions/:id', deleteCondition);
router.post('/patients/:customerId/visit-notes', addVisitNote);
router.put('/patients/:customerId/visit-notes/:id', updateVisitNote);

module.exports = router;

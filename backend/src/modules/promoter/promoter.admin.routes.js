/**
 * Super admin API for the promoter program — mounted at /api/v1/superadmin/promoter-program.
 */
const express = require('express');
const pool = require('../../config/database');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { route, httpError } = require('../../utils/route');
const { staffActor } = require('./promoter.audit');
const settingsService = require('./settings.service');
const settingsSchema = require('./settings.schema');
const schemes = require('./scheme.service');
const promoters = require('./promoter.service');
const referrals = require('./referral.service');
const commission = require('./commission.service');
const payouts = require('./payout.service');
const dashboard = require('./dashboard.service');

const router = express.Router();
router.use(requireAuth, requireRole('super_admin'));

// Turns service errors that carry a status (SettingsError, SchemeError, TermsError...) into HTTP errors
const r = (fn, opts) => route(fn, opts);

// ---------- Overview / audit ----------
router.get('/overview', r(() => dashboard.adminOverview()));
router.get('/audit', r((req) => dashboard.adminAudit(req.query)));
router.get('/ledger', r((req) => dashboard.adminLedger(req.query)));

// ---------- Settings ----------
router.get('/settings', r(() => settingsService.getCurrent()));
router.get('/settings/schema', r(() => settingsSchema.describe()));
router.get('/settings/history', r((req) => settingsService.getHistory(req.query.limit)));
router.post('/settings/preview', r((req) => settingsService.previewSettings(req.body?.changes)));
router.put('/settings', r((req) => settingsService.saveSettings({
  changes: req.body?.changes, baseVersion: req.body?.baseVersion, reason: req.body?.reason
}, staffActor(req))));

// ---------- Schemes ----------
router.get('/schemes', r(() => schemes.listSchemes()));
router.post('/schemes', r((req) => schemes.createScheme(req.body || {}, staffActor(req)), { status: 201 }));
router.get('/schemes/:id', r((req) => schemes.getScheme(req.params.id)));
router.put('/schemes/:id', r((req) => schemes.saveVersion(req.params.id, req.body || {}, staffActor(req))));
router.post('/schemes/:id/preview', r((req) => schemes.previewVersion(req.params.id, req.body || {})));

// ---------- Promoters ----------
router.get('/promoters', r((req) => promoters.list(req.query)));
router.post('/promoters', r((req) => promoters.adminCreate(req.body, staffActor(req)), { status: 201 }));
router.get('/promoters/:id', r((req) => promoters.getDetail(req.params.id)));
router.post('/promoters/:id/:action(approve|reject|suspend|reactivate|terminate)', r((req) =>
  promoters.changeStatus(req.params.id, req.params.action, req.body || {}, staffActor(req))));
router.put('/promoters/:id/terms', r((req) => promoters.updateTerms(req.params.id, req.body, staffActor(req))));
router.post('/promoters/:id/kyc', r((req) => promoters.reviewKyc(req.params.id, req.body || {}, staffActor(req))));

// ---------- Referrals (per clinic) ----------
router.get('/tenants/:tenantId/referral', r((req) => referrals.getForTenant(req.params.tenantId)));
router.post('/tenants/:tenantId/referral', r((req) => referrals.adminAssign(req.params.tenantId, req.body || {}, staffActor(req))));
router.post('/tenants/:tenantId/referral/status', r((req) => referrals.setStatus(req.params.tenantId, req.body || {}, staffActor(req))));
router.post('/tenants/:tenantId/referral/terms', r((req) => referrals.changeTerms(req.params.tenantId, req.body || {}, staffActor(req))));

// ---------- Adjustments ----------
router.post('/adjustments', r(async (req) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entry = await commission.addAdjustment(client, {
      promoterId: req.body?.promoter_id, tenantId: req.body?.tenant_id || null,
      amountPaise: req.body?.amount_paise, note: req.body?.note
    }, staffActor(req));
    await client.query('COMMIT');
    return entry;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}, { status: 201 }));

// ---------- Payouts ----------
router.get('/payouts', r((req) => payouts.list({ status: req.query.status, periodMonth: req.query.period_month, promoterId: req.query.promoter_id })));
router.post('/payouts/run', r((req) => payouts.runPayouts({ periodMonth: req.body?.period_month, promoterIds: req.body?.promoter_ids }, staffActor(req))));
router.get('/payouts/export.csv', async (req, res) => {
  try {
    const csv = await payouts.exportCsv({ status: req.query.status || 'approved', periodMonth: req.query.period_month }, staffActor(req));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="promoter-payouts-${req.query.period_month || 'all'}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: 'Export failed' });
  }
});
router.get('/payouts/:id', r((req) => payouts.getWithEntries(req.params.id)));
router.get('/payouts/:id/statement.pdf', async (req, res) => {
  try {
    const { buffer, filename } = await payouts.statementPdf(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(err.status || 500).json({ success: false, data: null, error: err.status ? err.message : 'Could not create the statement' });
  }
});
router.post('/payouts/:id/:action(approve|mark_paid|mark_failed|cancel)', r((req) =>
  payouts.transition(req.params.id, req.params.action, req.body || {}, staffActor(req))));

// Manual trigger for the daily job (release + reconcile), useful after unfreezing accruals
router.post('/jobs/release', r(async () => {
  const { runDailyJob } = require('../../cron/promoter.cron');
  return runDailyJob();
}));

router.use((req, res) => res.status(404).json({ success: false, data: null, error: 'Not found' }));

module.exports = router;

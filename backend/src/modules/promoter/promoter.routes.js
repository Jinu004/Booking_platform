/**
 * Partner portal API — mounted at /api/v1/partner.
 * Every authenticated query is scoped to req.promoter.id; a promoter id is never read from the request.
 */
const express = require('express');
const { authLimiter } = require('../../middleware/rateLimiter');
const { route, httpError } = require('../../utils/route');
const auth = require('./promoter.auth');
const promoterService = require('./promoter.service');
const referralService = require('./referral.service');
const dashboard = require('./dashboard.service');
const payouts = require('./payout.service');
const pool = require('../../config/database');

const router = express.Router();

// The sign-up form checks codes as the clinic types: allow more than the strict auth limiter,
// but still enough of a cap that codes cannot be enumerated.
const rateLimit = require('express-rate-limit');
const codeCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, data: null, error: 'Too many requests. Please try again later.' }
});

// ---------- Public ----------
router.get('/config', route(() => referralService.publicConfig()));
router.get('/code/:code', codeCheckLimiter, route((req) => referralService.validateCode(req.params.code)));
router.post('/apply', authLimiter, route((req) => promoterService.apply(req.body, { ip: req.ip }), { status: 201 }));
router.post('/login', authLimiter, route((req) => auth.login(req.body || {}, { ip: req.ip, userAgent: req.headers['user-agent'] })));
router.post('/forgot-password', authLimiter, route((req) => auth.forgotPassword(req.body || {})));
router.post('/reset-password', authLimiter, route((req) => auth.resetPassword(req.body || {}, { ip: req.ip })));

// ---------- Authenticated promoter ----------
router.use(auth.requirePromoter);

router.post('/logout', route((req) => auth.logout(req)));
router.get('/me', route(async (req) => {
  const q = await pool.query(`SELECT ${promoterService.PUBLIC_COLUMNS} FROM promoters WHERE id = $1`, [req.promoter.id]);
  return promoterService.selfView(q.rows[0]);
}));
router.post('/me/password', route((req) => auth.changePassword(req.promoter.id, req.body || {})));
router.put('/me/payout-details', route((req) => promoterService.updatePayoutDetails(req.promoter.id, req.body, { ip: req.ip })));
router.post('/me/accept-agreement', route((req) => promoterService.acceptAgreement(req.promoter.id, req.body?.version, { ip: req.ip })));

router.get('/dashboard/summary', route((req) => dashboard.partnerSummary(req.promoter.id)));
router.get('/dashboard/monthly', route((req) => dashboard.partnerMonthly(req.promoter.id)));
router.get('/clinics', route((req) => dashboard.partnerClinics(req.promoter.id)));
router.get('/earnings', route((req) => dashboard.partnerEarnings(req.promoter.id, req.query)));
router.get('/payouts', route((req) => dashboard.partnerPayouts(req.promoter.id)));
router.get('/payouts/:id/statement.pdf', async (req, res) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw httpError('Payout not found', 404);
    const { buffer, filename } = await payouts.statementPdf(req.params.id, { promoterId: req.promoter.id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(err.status || 500).json({ success: false, data: null, error: err.status ? err.message : 'Could not create the statement' });
  }
});

module.exports = router;

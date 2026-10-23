/**
 * Billing routes.
 *  - Super admin (mounted at /api/v1/superadmin): plans and payments of any clinic.
 *  - Clinic admin (mounted at /api/v1/billing): the clinic's own payment history.
 */
const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { route } = require('../../utils/route');
const { staffActor } = require('../promoter/promoter.audit');
const billing = require('./billing.service');

const adminRouter = express.Router();
adminRouter.use(requireAuth, requireRole('super_admin'));

adminRouter.get('/plans', route(() => billing.listPlans()));
adminRouter.patch('/plans/:id', route((req) => billing.updatePlan(req.params.id, req.body || {}, staffActor(req))));

adminRouter.get('/tenants/:id/payments', route((req) => billing.listPayments(req.params.id)));
adminRouter.post('/tenants/:id/payments', route((req) => billing.recordPayment(req.params.id, req.body || {}, staffActor(req)), { status: 201 }));
adminRouter.post('/payments/:id/refund', route((req) => billing.refundPayment(req.params.id, req.body || {}, staffActor(req))));
adminRouter.post('/payments/:id/void', route((req) => billing.voidPayment(req.params.id, req.body || {}, staffActor(req))));

const clinicRouter = express.Router();
clinicRouter.use(requireAuth, requireRole('admin', 'super_admin'));
clinicRouter.get('/payments', route((req) => billing.listOwnPayments(req.tenantId)));

module.exports = { adminRouter, clinicRouter };

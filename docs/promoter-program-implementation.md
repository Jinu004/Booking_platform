# Promoter Program — what was built and how to launch it

Companion to `promoter-program-plan.md`. Everything in the plan's phases 0–4 is implemented. Phase 5 (payment gateway automation) is not.

## Deploy

1. Backend: pull, then `npm run migrate` (adds migrations 044–047; all additive, no existing table is changed), then restart PM2.
   - `TOKEN_ENCRYPTION_KEY` must be set (already needed for WhatsApp tokens). It also encrypts promoter bank account numbers.
   - `FRONTEND_URL` is used in partner emails (defaults to https://receptionai.in).
2. Frontend: build and upload as usual.
3. Nothing changes for clinics until you switch the program on.

## Go-live checklist (Super Admin → Promoter Program)

1. **Plans & prices**: check the three prices. They are now the single source for the sign-up page and revenue stats (seeded with 2,999 / 5,999 / 9,999).
2. **Schemes**: review "Standard" (seeded 20%, 12 months). Add tiers, per-plan rates, bonus or cap if wanted.
3. **Settings**:
   - Replace the agreement text with your real partner agreement.
   - Confirm the TDS and GST values with your CA (seeded TDS 2% with PAN, 20% without, ₹20,000 yearly threshold, GST 18% for GST-registered promoters).
   - Hold period, payout day, minimum payout, attribution and fraud policies.
   - Turn **Program enabled** on.
4. Record clinic payments from **Super Admin → clinic → Payments**. Commission is created only from recorded payments.
5. Recommended: run one month in "shadow mode" (record payments, do not pay out), and check the ledger against your own sheet.

## Where things live

| Area | Files |
|---|---|
| Migrations | `backend/database/migrations/044_plans_and_payments.sql` … `047_promoter_commissions.sql` |
| Billing (plans, payments) | `backend/src/modules/billing/` |
| Promoter program | `backend/src/modules/promoter/` — `settings.schema.js` (every setting, its limits and when it takes effect), `settings.service.js`, `scheme.service.js`, `terms.service.js`, `commission.service.js` (ledger engine), `referral.service.js`, `promoter.service.js`, `promoter.auth.js`, `payout.service.js`, `dashboard.service.js`, routes |
| Daily / monthly jobs | `backend/src/cron/promoter.cron.js` (02:15 IST release + reconcile; 03:30 IST payout drafts on the configured run day) |
| Money helpers | `backend/src/utils/money.js` (paise, basis points, dates — BigInt math) |
| Partner portal | `frontend/src/partner/` (`/partner/login`, `/partner/apply`, `/partner`, clinics, earnings, payouts, profile) |
| Super admin UI | `frontend/src/pages/superadmin/PromoterProgram.jsx`, `PromoterDetail.jsx`, `promoter/*Tab.jsx`, `frontend/src/components/superadmin/{Payments,Referral}Panel.jsx` (on the clinic edit page) |
| Sign-up | `frontend/src/pages/Onboarding.jsx` (referral code field, live prices), `frontend/src/utils/referral.js` (`?ref=` link memory) |

## API

- Partner: `/api/v1/partner/*` — separate login, sessions and JWT type; staff tokens are rejected there and partner tokens are rejected by every staff API.
- Super admin: `/api/v1/superadmin/promoter-program/*` and `/api/v1/superadmin/billing/*`.
- Clinic admin: `/api/v1/billing/payments` (own payment history, shown in Settings → Billing).

## Guarantees enforced in code and database

- Commission only from recorded payments; one commission per payment (unique index) — retries and double clicks are harmless.
- The ledger is append-only (database trigger): no deletes, amounts never change, paid/void entries are final. Corrections are reversal or adjustment entries.
- Settings, schemes and per-clinic terms are versioned; each commission entry stores the settings version, scheme version, terms and rate it used.
- A terms change can never start before a period that already earned commission.
- Saving settings or a scheme uses optimistic locking (a stale screen gets "changed by someone else").
- Payout runs and the daily job take Postgres advisory locks.
- Money records survive clinic deletion (name snapshots, `ON DELETE SET NULL`); deleting a clinic with unpaid commission needs an extra confirmation.
- Promoters never see patient, conversation or contact data of clinics.

## Tests

- `npm test` — unit tests (commission math, TDS, settings schema; no database).
- `TEST_DATABASE_URL=postgresql://…/receptionai_test npm run test:integration` — 15 end-to-end scenarios through the HTTP API (apply/approve/login, token separation, sign-up attribution, self-referral flag, payments, refunds, voids, release, scheme change from a date, KYC gate, payouts, CSV, PDF, IDOR, clawback, reassignment, revoke, late attribution, freeze/reconcile, termination, agreement re-acceptance, clinic deletion, backdated payments, permanent-skip marking, revoke keeping money owed back, duplicate cash payments). The database must be migrated and its name must contain "test"; Redis must be running.

## Known limits / follow-ups

- No payment gateway yet: payments are entered by a super admin. A gateway webhook can later insert into `subscription_payments` and call `commission.accrueForPayment` (the unique reference index makes webhook retries safe).
- The pricing section on the landing page and `PricingCalculator` still have their own hard-coded prices (marketing copy / what-if tool). The sign-up page now uses live prices.
- No QR code on the partner overview (the link can be copied or shared on WhatsApp).
- Found while testing on a fresh database (not caused by this work): `030_conversations_mode.sql` uses `ADD CONSTRAINT IF NOT EXISTS`, which PostgreSQL does not support, and `infrastructure/baseline.sql` lacks some columns production has (e.g. `tenants.whatsapp_phone_number_id`, table `procedures`). Production is unaffected, but a new environment cannot be built from the repo alone.

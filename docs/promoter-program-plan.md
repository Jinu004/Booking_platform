# Promoter (Referral Partner) Program — Implementation Plan

Status: proposal · Author: Claude for Sonu (Autobonics) · Date: 2026-10-23

Goal: let external promoters onboard clinics onto ReceptionAI and earn a percentage of each referred clinic's recurring subscription revenue, with their own dashboard, and with super admin control over attribution, commissions and payouts.

---

## 0. TL;DR

1. **There is no billing system today**, so there is nothing reliable to take a percentage of. Plan prices are hard-coded in four places (and disagree), and "revenue" in super admin stats is `plan × count of active tenants`. **Phase 0 must add a payments ledger** (`subscription_payments`). Commission is then computed only from money actually received, never from the plan a tenant is on.
2. **Promoters are a separate identity, not a `staff` role.** `staff.tenant_id` and `auth_sessions.tenant_id` are NOT NULL and `requireAuth` joins `tenants`; the sidebar also gives `super_admin` every link. A promoter must never be able to reach a tenant API. They get their own table, sessions, JWT type, middleware, route prefix (`/api/v1/partner`) and frontend area (`/partner`).
3. **Attribution is locked once, at signup**, via a referral code that the clinic sees and confirms in the onboarding form. It is stored in `tenant_referrals`, and the commission terms that applied are recorded as a dated **terms version**. Only a super admin can change them, with a reason and an effective date, and changes apply to future payments only.
7. **Every business rule is configurable from the super admin panel, nothing is hard-coded.** Rates, durations, tiers, per-plan rates, hold period, payout schedule, minimum payout, tax rates, attribution and fraud policies, and the partner agreement live in versioned settings and *commission schemes*. Each change is validated, needs a reason, is kept in history, and has a defined moment when it takes effect (§2). Commission entries record which settings version and scheme produced them, so any past number can be explained.
4. **Commissions live in an append-only ledger** (`promoter_commissions`) in integer paise with rates in basis points. Each payment creates at most one commission entry (unique index). Refunds create negative reversal entries; nothing is ever edited or deleted.
5. **Hold → release → payout.** New commission is `pending` for a hold period (for example 30 days), then becomes `available` through a daily cron, then is grouped into a monthly `promoter_payouts` batch that a super admin approves and marks paid with a UTR.
6. **Financial records must survive tenant deletion.** Migration 039 cascades tenant FKs, and `audit_logs.tenant_id` is NOT NULL with `ON DELETE CASCADE`. All new money tables use `ON DELETE SET NULL` + name snapshots, and promoter actions are logged to a separate `promoter_audit_logs`.

---

## 1. What exists today (findings that shape the design)

| Area | What the code does | Consequence for this feature |
|---|---|---|
| Stack | Express (CommonJS) + `pg` + Redis + `node-cron`; React 18 + Vite + Tailwind + zustand + recharts | Reuse everything; no new framework needed |
| Migrations | `backend/src/database/migrate.js` runs `backend/database/migrations/*.sql` in name order, each in a transaction, logged in `migrations_log`. Latest is `043_campaigns.sql`. (A second, older folder `backend/src/database/migrations/` is **not** run by `migrate.js`.) | New files: `044_…` onward in `backend/database/migrations/` |
| Tenants | `tenants(id, name, slug, industry, plan, status, whatsapp_number, ai_model, …)`. Status `pending → active / suspended`. | Commission depends on payment, not status, but status drives dashboard display |
| Clinic signup | Public `POST /api/v1/onboarding/clinic` creates tenant (status `pending`), clinic profile, configs, admin staff, session in **one transaction**. Super admin also creates tenants via `POST /superadmin/tenants`. | Referral is inserted in the same transaction; both entry points must support it |
| Plans and prices | `onboarding.controller.getPlans` (2999/5999/9999), `frontend/src/constants PLANS` (2999…), `superadmin.getPlatformStats` hard-coded CASE (2999/5999/9999), `PricingCalculator` (2499/4999/8999). Settings → Billing says "contact support". | No single source of truth, no payment records. Fix in Phase 0 |
| Auth | JWT (7d) + `auth_sessions.token_hash` (sha256) lookup; `requireAuth` joins `staff` and `tenants`; `requireRole(...)`. Super admin is a `staff` row with role `super_admin`. | Promoter auth mirrors this pattern on its own tables |
| Audit | `utils/audit.logAction` → `audit_logs` (tenant_id NOT NULL, cascades on tenant delete) | Need `promoter_audit_logs` that does not cascade |
| Secrets | `utils/secretBox` `encrypt/decrypt` | Use for promoter bank account numbers |
| Email | Resend via `utils/email.js` | Promoter welcome / reset / payout emails |
| Cron | `backend/src/cron/*.cron.js`, started in `index.js`, `timezone: 'Asia/Kolkata'` | Add `promoter.cron.js` |
| Rate limiting | `apiLimiter`, `authLimiter`, `webhookLimiter` | Apply `authLimiter` to partner login/apply/reset and code validation |
| Tests | None in the repo | Add `node:test` tests for the money logic (no new dependency) |

---

## 2. Configuration model (everything editable from the admin panel)

Nothing in the program is hard-coded. Rules come from three layers, and the most specific layer wins:

```
Referral terms (one clinic, dated versions)      e.g. "Clinic X: 25% from 1 Jan 2027"
      ▲ overrides
Promoter overrides (one promoter)                 e.g. "Agency A: 12 → 24 months"
      ▲ overrides
Commission scheme (named, reusable)               e.g. "Standard", "Agency Gold"
  · base rate · duration · per-plan rates · tiers
      ▲ falls back to
Program settings (global, versioned)              hold days, payouts, tax, policies, defaults
```

### 2.1 Why "dynamic" still has to be safe

Settings can change at any time, but **a change must never rewrite money already earned or a promise already made to a promoter**. Three rules make that possible:

1. **Versioned, never overwritten.** Saving settings or a scheme creates a new version row. The old version stays, so you can always see what applied on a given date. "Revert" means saving the old values again as a new version.
2. **Every change has a defined effective point** (table below). The admin UI shows it next to the field before saving, for example "Applies to referrals created after you save".
3. **Every computed number records its inputs.** Each commission entry stores `settings_version_id`, `scheme_id`, `terms_id`, `tier_id`, `rate_bps` and `rate_source`. Existing entries are never recalculated. To correct one, add an adjustment entry.

Every save is checked on the server (types, min/max, cross-field rules such as "tier thresholds must increase"), requires a **reason**, writes `promoter_audit_logs` with before/after, and clears the settings cache. Settings are cached in Redis for 60 s and the cache is cleared on save. Changes with a large financial effect (rate or duration changes that touch existing referrals, turning the program off, lowering the hold period) open a confirmation dialog with an **impact preview**: how many promoters and referrals it affects and a sample calculation.

### 2.2 Program settings (global, versioned) — Admin → Promoter Program → Settings

| Group | Setting | Seed default | When a change takes effect |
|---|---|---|---|
| General | Program enabled | off | Immediately. Off hides apply/signup capture; existing referrals keep earning unless "Freeze accruals" is also on |
| General | Freeze accruals (emergency switch) | off | Immediately. Payments still record; commission accrual waits and catches up via reconciliation when switched off |
| General | Default commission scheme | "Standard" | New promoters only |
| Promoters | Approval mode | manual / auto-approve | New applications |
| Promoters | Allow clinics (existing tenants) to be promoters | off | New applications |
| Promoters | KYC required before payout | on | Next payout run |
| Promoters | Code format (length, prefix) | 8 chars | New codes only |
| Attribution | Referral link memory in browser (days) | 60 | New visitors |
| Attribution | Clinic can edit the prefilled code | on | Immediately |
| Attribution | Late attribution allowed (days after signup an admin may attach a promoter) | 30 | Immediately |
| Attribution | Reassignment allowed | on, with reason | Immediately |
| Attribution | Self-referral policy | flag for review / block / allow | New signups |
| Attribution | Returning clinic policy (same WhatsApp, email or phone as a past tenant) | flag / no commission / allow | New signups |
| Commission base | Exclude GST | on | Payments recorded after the change |
| Commission base | Payment types that earn commission | subscription only (not setup fees or pass-through charges) | Payments recorded after the change |
| Commission base | Commission starts at | first paid period / clinic approval date | New referrals |
| Hold | Hold period (days) | 30 | Entries accrued after the change (stored as `available_at`) |
| Payouts | Frequency | monthly | Next run |
| Payouts | Run day of month | 5 | Next run |
| Payouts | Auto-create drafts | on | Next run |
| Payouts | Minimum payout (₹) | 1,000 | Next run |
| Payouts | Payout methods offered | UPI, bank | Immediately |
| Tax | TDS rate (bps), rate without PAN, yearly threshold (₹) | to confirm with your CA | Next payout run (each payout stores the values it used) |
| Tax | GST on commission for GST-registered promoters (bps) | to confirm with your CA | Next payout run |
| Policies | Suspended promoter | hold releases / keep releasing | Immediately |
| Policies | Terminated promoter | forfeit unpaid / pay out balance | Applies at the time of termination |
| Policies | Refund after payout | claw back from next payouts / absorb | Refunds recorded after the change |
| Agreement | Agreement text (Markdown) + version | v1 | New version → promoters must accept it at next login before using the dashboard |
| Notifications | Emails: approval, new clinic, commission available, payout paid | all on | Immediately |

### 2.3 Commission schemes — Admin → Promoter Program → Schemes

A scheme is a named, reusable set of commission terms. Each promoter is assigned one scheme. Schemes are versioned like settings.

| Field | Example | Notes |
|---|---|---|
| Name, description, active | "Standard" | Inactive schemes can't be assigned to new promoters |
| Base rate (bps) | 2000 (20%) | 0–50% allowed, checked on the server |
| Duration (months) | 12, or empty = lifetime | |
| Per-plan rates | Pro: 25% | Optional; falls back to the base rate |
| Tiers | 0–4 active clinics 20%, 5–9: 25%, 10+: 30% | Threshold metric: active paying clinics in the previous month |
| Tier mode | **Locked at signup** or **live at payment** | Locked: the clinic keeps the tier rate it had when referred. Live: rate is recalculated for each payment from the promoter's current tier |
| One-time bonus per clinic (₹, optional) | ₹500 after the first payment | Stored as an `adjustment` entry |
| Rate cap per clinic per month (₹, optional) | | Protection for very large plans |
| Apply changes to | **New referrals only** (default) or **existing referrals from a date** | The second choice creates new terms versions for every affected referral from that date and shows the impact preview first |

**How the rate for a payment is chosen** (recorded as `rate_source` on the entry):
referral terms override → promoter override → scheme per-plan rate → scheme tier rate → scheme base rate.

### 2.4 Per-promoter and per-clinic overrides

- **Promoter detail page**: change scheme, override rate/duration, override payout minimum, mark KYC verified, suspend/terminate. Each option has an "applies to new referrals only / also existing from date" choice.
- **Clinic (TenantEdit) → Referral panel**: list of dated terms versions; "Change terms from date…" adds a new version (never edits an old one); reassign or revoke with a reason.

## 3. Architecture overview

```
           ┌────────────── Public ──────────────┐
 Landing ──► /onboarding?ref=CODE ──► POST /onboarding/clinic {..., referralCode}
                                         │ (same DB transaction)
                                         ▼
 tenants ◄── tenant_referrals (promoter_id, rate_bps, months, status)
    │
    │  money in (Phase 0: super admin records it; Phase 5: payment gateway webhook)
    ▼
 subscription_payments ──► commission.service.accrueForPayment()  (same transaction)
                                         │  idempotent (unique per payment)
                                         ▼
                              promoter_commissions  (append-only ledger)
                                pending ──(daily cron, after hold)──► available
                                                                          │
                                         monthly cron drafts ─────────────┘
                                                   ▼
                              promoter_payouts (draft → approved → paid, UTR)

 Partner portal  /partner/*   ──► /api/v1/partner/*        (requirePromoter)
 Super admin     /superadmin/* ──► /api/v1/superadmin/promoters|payments|payouts (requireAuth + super_admin)
```

New backend modules:

```
backend/src/modules/billing/      plans.service.js, payments.controller.js, payments.service.js, billing.routes.js
backend/src/modules/promoter/     promoter.auth.middleware.js, promoter.auth.controller.js,
                                  promoter.controller.js (dashboard APIs), promoter.service.js,
                                  referral.service.js, commission.service.js, payout.service.js,
                                  promoter.routes.js (partner), promoter.admin.routes.js (super admin)
backend/src/cron/promoter.cron.js
backend/src/utils/money.js         paise/bps helpers, overlap-days math
```

---

## 4. Data model

All amounts are **integer paise** (`BIGINT`), rates are **basis points** (`INTEGER`, 2000 = 20%), timestamps are `TIMESTAMPTZ`. Money tables reference tenants with `ON DELETE SET NULL` and keep a `tenant_name` snapshot.

### 044_plans_and_payments.sql (Phase 0)

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS plans (
  id                    VARCHAR(20) PRIMARY KEY,          -- 'starter' | 'growth' | 'pro'
  name                  VARCHAR(50) NOT NULL,
  monthly_price_paise   BIGINT NOT NULL CHECK (monthly_price_paise >= 0),
  is_active             BOOLEAN NOT NULL DEFAULT true,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO plans (id, name, monthly_price_paise) VALUES
  ('starter','Starter',299900), ('growth','Growth',599900), ('pro','Pro',999900)
ON CONFLICT (id) DO NOTHING;   -- confirm the real prices first (see §1)

CREATE TABLE IF NOT EXISTS subscription_payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID REFERENCES tenants(id) ON DELETE SET NULL,
  tenant_name        TEXT NOT NULL,                        -- snapshot
  plan_id            VARCHAR(20) REFERENCES plans(id),
  gross_paise        BIGINT NOT NULL CHECK (gross_paise > 0),
  tax_paise          BIGINT NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  net_paise          BIGINT GENERATED ALWAYS AS (gross_paise - tax_paise) STORED,
  refunded_paise     BIGINT NOT NULL DEFAULT 0 CHECK (refunded_paise >= 0),
  currency           CHAR(3) NOT NULL DEFAULT 'INR',
  period_start       DATE NOT NULL,
  period_end         DATE NOT NULL,                        -- inclusive
  paid_at            TIMESTAMPTZ NOT NULL,
  method             VARCHAR(20) NOT NULL CHECK (method IN ('upi','bank_transfer','cash','cheque','gateway')),
  external_ref       VARCHAR(100),                         -- UTR / gateway payment id
  status             VARCHAR(20) NOT NULL DEFAULT 'captured'
                     CHECK (status IN ('captured','partially_refunded','refunded','voided')),
  recorded_by        UUID REFERENCES staff(id) ON DELETE SET NULL,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK (refunded_paise <= gross_paise - tax_paise)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_external_ref
  ON subscription_payments (method, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_tenant_paid ON subscription_payments (tenant_id, paid_at DESC);

COMMIT;
```

### 045_promoter_config.sql (Phase 1)

```sql
BEGIN;

-- Global program settings: one row per version, never updated. The newest row is the current one.
CREATE TABLE IF NOT EXISTS promoter_program_settings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version      INTEGER NOT NULL UNIQUE,
  settings     JSONB NOT NULL,          -- validated against a JSON schema in code (settings.schema.js)
  reason       TEXT NOT NULL,
  created_by   UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commission_schemes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(100) NOT NULL UNIQUE,
  description  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  current_version_id UUID,              -- points at commission_scheme_versions
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commission_scheme_versions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id          UUID NOT NULL REFERENCES commission_schemes(id) ON DELETE RESTRICT,
  version            INTEGER NOT NULL,
  base_rate_bps      INTEGER NOT NULL CHECK (base_rate_bps BETWEEN 0 AND 5000),
  commission_months  INTEGER CHECK (commission_months IS NULL OR commission_months > 0),
  tier_mode          VARCHAR(20) NOT NULL DEFAULT 'locked' CHECK (tier_mode IN ('locked','live')),
  plan_rates         JSONB NOT NULL DEFAULT '{}',   -- {"pro": 2500}
  tiers              JSONB NOT NULL DEFAULT '[]',   -- [{"min_active":0,"rate_bps":2000},{"min_active":5,"rate_bps":2500}]
  first_payment_bonus_paise BIGINT CHECK (first_payment_bonus_paise IS NULL OR first_payment_bonus_paise >= 0),
  monthly_cap_paise  BIGINT CHECK (monthly_cap_paise IS NULL OR monthly_cap_paise > 0),
  reason             TEXT NOT NULL,
  created_by         UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scheme_id, version)
);

-- Seed: settings v1 and a "Standard" scheme with the defaults from §2 (values editable afterwards in the UI)

COMMIT;
```

Settings are stored as JSONB so new options can be added without a migration. The JSON schema in `backend/src/modules/promoter/settings.schema.js` is the single list of allowed keys, types, ranges and defaults. Missing keys fall back to the defaults in that file, so older versions still load.

### 046_promoters.sql (Phase 1)

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS promoters (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     VARCHAR(16) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{6,16}$'),
  name                     VARCHAR(255) NOT NULL,
  email                    VARCHAR(255) NOT NULL,
  phone                    VARCHAR(20) NOT NULL,             -- normalised +91…
  city                     VARCHAR(100),
  password_hash            VARCHAR(255),
  status                   VARCHAR(20) NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','active','suspended','terminated','rejected')),
  scheme_id                UUID NOT NULL REFERENCES commission_schemes(id) ON DELETE RESTRICT,
  override_rate_bps        INTEGER CHECK (override_rate_bps IS NULL OR override_rate_bps BETWEEN 0 AND 5000),
  override_commission_months INTEGER CHECK (override_commission_months IS NULL OR override_commission_months > 0),
  override_min_payout_paise BIGINT,
  pan                      VARCHAR(10),
  gstin                    VARCHAR(15),
  payout_method            VARCHAR(10) CHECK (payout_method IN ('upi','bank')),
  upi_id                   VARCHAR(100),
  bank_account_enc         TEXT,                             -- secretBox.encrypt
  bank_account_last4       VARCHAR(4),
  bank_ifsc                VARCHAR(11),
  bank_holder_name         VARCHAR(255),
  kyc_status               VARCHAR(20) NOT NULL DEFAULT 'not_submitted'
                           CHECK (kyc_status IN ('not_submitted','submitted','verified','rejected')),
  agreement_version        VARCHAR(20),
  agreement_accepted_at    TIMESTAMPTZ,
  approved_by              UUID REFERENCES staff(id) ON DELETE SET NULL,
  approved_at              TIMESTAMPTZ,
  last_login               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_promoters_email ON promoters (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS uq_promoters_phone ON promoters (phone);

CREATE TABLE IF NOT EXISTS promoter_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL REFERENCES promoters(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promoter_password_resets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL REFERENCES promoters(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One promoter per tenant. Terms live in referral_terms (dated versions).
CREATE TABLE IF NOT EXISTS tenant_referrals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID UNIQUE REFERENCES tenants(id) ON DELETE SET NULL,
  tenant_name          TEXT NOT NULL,
  promoter_id          UUID NOT NULL REFERENCES promoters(id) ON DELETE RESTRICT,
  source               VARCHAR(20) NOT NULL CHECK (source IN ('signup_link','signup_manual_code','admin_assigned')),
  window_start         DATE,          -- set on first captured payment (or approval date, per settings)
  status               VARCHAR(20) NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','flagged','revoked')),
  flag_reason          TEXT,
  attributed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID REFERENCES staff(id) ON DELETE SET NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referrals_promoter ON tenant_referrals (promoter_id, status);

-- Dated terms for a referral. Never updated; a change adds a row with a later effective_from.
CREATE TABLE IF NOT EXISTS referral_terms (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id         UUID NOT NULL REFERENCES tenant_referrals(id) ON DELETE RESTRICT,
  effective_from      DATE NOT NULL,
  scheme_version_id   UUID NOT NULL REFERENCES commission_scheme_versions(id),
  override_rate_bps   INTEGER CHECK (override_rate_bps IS NULL OR override_rate_bps BETWEEN 0 AND 5000),
  commission_months   INTEGER CHECK (commission_months IS NULL OR commission_months > 0), -- resolved at creation; NULL = lifetime
  locked_tier_rate_bps INTEGER,      -- set when the scheme's tier_mode = 'locked'
  reason              TEXT NOT NULL,
  created_by          UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (referral_id, effective_from)
);

-- Non-cascading audit trail for everything money/attribution related
CREATE TABLE IF NOT EXISTS promoter_audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type   VARCHAR(20) NOT NULL CHECK (actor_type IN ('staff','promoter','system')),
  actor_id     UUID,
  action       VARCHAR(100) NOT NULL,
  promoter_id  UUID,
  tenant_id    UUID,
  entity_type  VARCHAR(50),
  entity_id    UUID,
  before       JSONB,
  after        JSONB,
  reason       TEXT,
  ip_address   VARCHAR(45),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promoter_audit_promoter ON promoter_audit_logs (promoter_id, created_at DESC);

COMMIT;
```

### 047_promoter_commissions.sql (Phase 2)

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS promoter_payouts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id    UUID NOT NULL REFERENCES promoters(id) ON DELETE RESTRICT,
  period_month   DATE NOT NULL,                         -- first day of the month covered
  gross_paise    BIGINT NOT NULL,
  tds_paise      BIGINT NOT NULL DEFAULT 0,
  tds_rate_bps   INTEGER,                               -- value used, copied from settings at run time
  gst_paise      BIGINT NOT NULL DEFAULT 0,
  settings_version_id UUID REFERENCES promoter_program_settings(id),
  net_paise      BIGINT GENERATED ALWAYS AS (gross_paise - tds_paise) STORED,
  status         VARCHAR(20) NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','approved','paid','failed','cancelled')),
  payout_method  VARCHAR(10),
  utr            VARCHAR(100),
  approved_by    UUID REFERENCES staff(id) ON DELETE SET NULL,
  approved_at    TIMESTAMPTZ,
  paid_at        TIMESTAMPTZ,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (gross_paise > 0 AND tds_paise >= 0 AND tds_paise <= gross_paise)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_promoter_month
  ON promoter_payouts (promoter_id, period_month) WHERE status <> 'cancelled';

CREATE TABLE IF NOT EXISTS promoter_commissions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id        UUID NOT NULL REFERENCES promoters(id) ON DELETE RESTRICT,
  referral_id        UUID NOT NULL REFERENCES tenant_referrals(id) ON DELETE RESTRICT,
  tenant_id          UUID REFERENCES tenants(id) ON DELETE SET NULL,
  tenant_name        TEXT NOT NULL,
  payment_id         UUID REFERENCES subscription_payments(id) ON DELETE RESTRICT,
  entry_type         VARCHAR(20) NOT NULL CHECK (entry_type IN ('commission','reversal','adjustment')),
  base_paise         BIGINT NOT NULL,                   -- eligible net amount used
  rate_bps           INTEGER NOT NULL,
  rate_source        VARCHAR(20) NOT NULL CHECK (rate_source IN ('referral_override','promoter_override','plan_rate','tier','base','adjustment')),
  terms_id           UUID REFERENCES referral_terms(id),
  scheme_version_id  UUID REFERENCES commission_scheme_versions(id),
  settings_version_id UUID REFERENCES promoter_program_settings(id),
  tier_index         INTEGER,
  eligible_days      INTEGER,                           -- overlap of paid period with window
  period_days        INTEGER,
  amount_paise       BIGINT NOT NULL,                   -- signed; negative for reversals
  status             VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','available','paid','void')),
  available_at       TIMESTAMPTZ NOT NULL,              -- paid_at + hold period
  payout_id          UUID REFERENCES promoter_payouts(id) ON DELETE RESTRICT,
  reverses_id        UUID REFERENCES promoter_commissions(id),
  note               TEXT,
  created_by         UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((entry_type = 'commission' AND amount_paise >= 0) OR entry_type <> 'commission'),
  CHECK (status <> 'paid' OR payout_id IS NOT NULL)
);
-- Idempotency: a payment can only ever produce one commission entry
CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_per_payment
  ON promoter_commissions (payment_id) WHERE entry_type = 'commission';
CREATE INDEX IF NOT EXISTS idx_commissions_promoter_status ON promoter_commissions (promoter_id, status, available_at);

-- Ledger is append-only: block deletes and changes to money columns
CREATE OR REPLACE FUNCTION promoter_commissions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'promoter_commissions is append-only';
  END IF;
  IF NEW.amount_paise <> OLD.amount_paise OR NEW.base_paise <> OLD.base_paise
     OR NEW.rate_bps <> OLD.rate_bps OR NEW.promoter_id <> OLD.promoter_id
     OR NEW.payment_id IS DISTINCT FROM OLD.payment_id THEN
    RAISE EXCEPTION 'commission amounts are immutable; insert an adjustment instead';
  END IF;
  IF OLD.status = 'paid' AND NEW.status <> 'paid' THEN
    RAISE EXCEPTION 'paid commissions cannot change status';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_promoter_commissions_guard ON promoter_commissions;
CREATE TRIGGER trg_promoter_commissions_guard
  BEFORE UPDATE OR DELETE ON promoter_commissions
  FOR EACH ROW EXECUTE FUNCTION promoter_commissions_guard();

COMMIT;
```

All program rules come from `promoter_program_settings` and the commission scheme tables (§2), not from code or `platform_config`.

---

## 5. Commission math (exact, testable)

For a captured payment `P` of a tenant with an `active` referral `R`, using the **current settings version `S`**:

```
if S.freeze_accruals or P.type not in S.commissionable_payment_types: stop (reconciliation picks it up later)
if R.window_start is NULL:            # first payment ever for this referral
    R.window_start = P.period_start   # or clinic approval date, per S.commission_starts_at

T  = referral_terms row of R with the latest effective_from <= P.period_start
V  = T.scheme_version
months = T.commission_months          # NULL = lifetime
window_end = months ? R.window_start + months months - 1 day : NULL

rate, rate_source = first non-null of:
    T.override_rate_bps                          -> 'referral_override'
    promoter.override_rate_bps                   -> 'promoter_override'
    V.plan_rates[P.plan_id]                      -> 'plan_rate'
    tier rate (T.locked_tier_rate_bps if V.tier_mode = 'locked',
               else tier for the promoter's active paying clinics last month) -> 'tier'
    V.base_rate_bps                              -> 'base'

period_days   = P.period_end - P.period_start + 1
eligible_days = days of [P.period_start, P.period_end] ∩ [R.window_start, window_end or ∞]
if eligible_days = 0: no entry

base_paise    = (S.exclude_gst ? P.net_paise : P.gross_paise) - P.refunded_paise
amount_paise  = floor(base_paise * eligible_days * rate / (period_days * 10000))
amount_paise  = min(amount_paise, V.monthly_cap_paise × months covered)   # only if a cap is set
available_at  = P.paid_at + S.hold_days
store rate, rate_source, T.id, V.id, S.id, tier index on the entry
if V.first_payment_bonus_paise and this is R's first commission: add an 'adjustment' entry for the bonus
```

Compute in SQL `NUMERIC` or JS `BigInt`, never JS floats.

Worked examples (Standard scheme seeded at 20%, 12 months, GST excluded; window starts 1 Nov 2026):

| Case | Payment | Result |
|---|---|---|
| Monthly Growth | ₹5,999 net, 1–30 Nov | 30/30 days → **₹1,199.80** (119,980 paise) |
| Annual prepay | ₹59,990 net, 1 Nov 2026 – 31 Oct 2027 | Fully inside window → ₹11,998.00 |
| Straddles window end | ₹5,999, 15 Oct – 13 Nov 2027 | Window ends 31 Oct 2027 → 17/30 days → ₹679.88 |
| Payment with GST | ₹7,078.82 gross, ₹1,079.82 tax | base ₹5,999 → ₹1,199.80 |

### Refunds and corrections

- **Full refund before the entry is paid** (status `pending` or `available`): mark the original entry `void`.
- **Partial refund before the entry is paid**: keep the original and insert a negative `reversal` for the refunded share, `-floor(refund_paise * eligible_days * rate_bps / (period_days * 10000))`, with the same status as the original. (The unique index allows only one `commission` entry per payment, so corrections are always separate entries.)
- **Refund after payout**: insert a negative `reversal` with status `available`. It nets against the next payout. A promoter's running balance may go negative; payouts are only created when the balance is ≥ the minimum.
- **Payment recorded by mistake**: set payment `status = 'voided'` (never delete), which triggers the same reversal logic.
- **Manual goodwill/correction**: `adjustment` entry by a super admin with a mandatory note and audit log row.

### Release rules (daily cron)

An entry moves `pending → available` only when all are true: `available_at <= now()`, the payment is still `captured`/`partially_refunded`, the referral is `active` (not `flagged`/`revoked`), and the promoter is `active`. Otherwise it waits (suspended promoter, flagged referral) or is voided (revoked for fraud, terminated promoter per agreement).

---

## 6. Core flows

### 6.1 Promoter signup and approval
1. Public page `/partner/apply` → `POST /api/v1/partner/apply` (authLimiter): name, email, phone, city, password, agreement checkbox (stores `agreement_version`, `agreement_accepted_at`). Status `pending`.
2. Super admin reviews in **Super Admin → Promoters**, picks a scheme (default from settings) and optional overrides, approves; or the request is approved automatically if approval mode is "auto". A unique code is generated server-side (e.g. 8 chars from `A–Z2–9` excluding look-alikes, retry on collision). Welcome email via Resend with the referral link.
3. Promoter logs in and completes KYC/payout details. No payout is created until `kyc_status = 'verified'`.

### 6.2 Referral capture (clinic onboarding)
1. Promoter shares `https://receptionai.in/?ref=CODE` or `/onboarding?ref=CODE`.
2. Frontend (`Landing.jsx`, `Onboarding.jsx`): on load, if `ref` is present, store `{code, ts}` in `localStorage` (`rai_ref`) for `promoter_ref_cookie_days`. Optional: `GET /api/v1/partner/code/:code` (rate-limited) returns only `{ valid, promoterName }` to show "Referred by Rahul K." — no other data.
3. Onboarding step 3 shows a **"Referral code (optional)"** field prefilled from storage, editable by the clinic. This is the clinic's explicit consent and the single source of attribution.
4. `onboardClinic` (inside the existing transaction, after creating the tenant):
   - look up an `active` promoter by `UPPER(TRIM(code))`; unknown/inactive code → ignore, log, do not fail signup;
   - self-referral and returning-clinic checks, handled per the policies in settings (flag for review, block, or allow);
   - insert `tenant_referrals` (`source = 'signup_link'` if it came from storage, else `signup_manual_code`) and its first `referral_terms` row (`effective_from` = signup date), resolved from the promoter's current scheme version and overrides; for a "locked" tier scheme, also store the promoter's tier rate at that moment;
   - write a `promoter_audit_logs` row.
5. Super admin `createTenant` gets an optional `promoterId` → `source = 'admin_assigned'`.
6. Frontend clears `rai_ref` after a successful signup.

Also add the referral field to the `PendingApproval` review in super admin so the approver sees who referred the clinic.

### 6.3 Money in → commission
Phase 0 (manual): **Super Admin → Tenant → Payments → Record payment** (`POST /superadmin/tenants/:id/payments`). In **one transaction**: insert payment → `commissionService.accrueForPayment(client, paymentId)` → audit row. Duplicate UTR is rejected by the unique index.

Phase 5 (automated): a payment-gateway subscription webhook (signature-verified, like the WhatsApp HMAC check) inserts the same `subscription_payments` row with `method = 'gateway'` and the gateway payment id as `external_ref`, and calls the same service. Because of the unique index, webhook retries are harmless.

Safety net: the nightly cron finds captured payments of referred tenants with no commission entry and accrues them (logs a warning each time — it should normally find nothing).

### 6.4 Payouts
1. Monthly cron (5th, 03:00 IST) or a super admin button: for each `active`, KYC-verified promoter, sum `available` entries with `available_at` before the 1st of the current month. If the sum ≥ minimum, create a `draft` payout and link the entries (`payout_id`) in one transaction. Negative sums carry forward.
2. Super admin reviews drafts, enters TDS (or auto-calculated from a configured rate), approves, exports a CSV for bank bulk transfer / UPI.
3. After transfer, super admin marks each payout `paid` with UTR and date → linked entries become `paid` → email to promoter with a PDF statement (`pdfkit` is already a dependency).
4. Failed transfer → payout `failed` → entries are unlinked back to `available` (allowed: they are not `paid` yet).

### 6.5 Changing terms, reassignment, disputes
**Changing terms**: from the clinic's Referral panel, or in bulk when a scheme is saved with "apply to existing referrals from date": insert new `referral_terms` rows with that `effective_from` (must not be before the latest payout already paid for that clinic). The impact preview runs the commission math on the clinic's last payments with old and new terms.

**Reassignment / disputes** — super admin only: `PATCH /superadmin/tenants/:id/referral` with `{promoterId | null, reason}`. Rules: affects **future payments only** (existing entries stay with the original promoter); reason is required; before/after go to `promoter_audit_logs`. Revoke for fraud = `status = 'revoked'` + void every unpaid entry of that referral.

### 6.6 Tenant lifecycle
- `pending` tenant that is never approved → no payments → no commission (dashboard shows "awaiting activation").
- `suspended` → no new payments → no new commission; history stays.
- Plan upgrade/downgrade → commission follows the next payment automatically.
- `deleteTenant` → tenant FKs become NULL; `tenant_name` snapshots keep promoter statements readable. **Add a guard**: block deleting a tenant with unpaid (`pending`/`available`) commissions, or require the super admin to confirm.

---

## 7. Backend API

### Partner (promoter) — `/api/v1/partner`
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/apply` | public, authLimiter | creates `pending` promoter |
| POST | `/login` | public, authLimiter | only `active` promoters get a session (pending → "awaiting approval") |
| POST | `/forgot-password`, `/reset-password` | public, authLimiter | same pattern as staff reset |
| GET | `/code/:code` | public, authLimiter | `{valid, promoterName}` only |
| POST | `/logout` | promoter | delete session |
| GET | `/me` | promoter | profile, code, link, KYC status (PAN/bank masked) |
| PATCH | `/me/payout-details` | promoter | sets `kyc_status = 'submitted'`; bank number encrypted |
| GET | `/dashboard/summary` | promoter | counts + balances (see §8) |
| GET | `/clinics` | promoter | paginated referred clinics |
| GET | `/earnings?from&to&status` | promoter | ledger entries, paginated |
| GET | `/earnings/monthly` | promoter | 12-month series for the chart |
| GET | `/payouts`, `/payouts/:id/statement.pdf` | promoter | own payouts only |

### Super admin — added to `superadmin.routes.js` (already behind `requireAuth` + `requireRole('super_admin')`)
| Method | Path |
|---|---|
| GET / POST | `/promoters` (list with filters / create directly) |
| GET / PATCH | `/promoters/:id` (scheme, overrides, status, KYC verify) |
| POST | `/promoters/:id/approve`, `/promoters/:id/reject` |
| GET | `/promoters/:id/referrals`, `/promoters/:id/ledger` |
| GET / POST | `/tenants/:id/payments`; PATCH `/payments/:id` (refund / void) |
| GET / PATCH | `/tenants/:id/referral` |
| POST | `/commissions/adjustments` |
| GET / POST | `/payouts`, `/payouts/run`; PATCH `/payouts/:id` (approve / paid / failed / cancel); GET `/payouts/export.csv` |
| GET | `/promoter-program/stats` |
| GET / PUT | `/promoter-program/settings` (PUT creates a new version; body includes `reason`) |
| GET | `/promoter-program/settings/history`, `/promoter-program/settings/schema` (field list, types, ranges, help text, effective point — drives the form) |
| POST | `/promoter-program/settings/preview` (impact preview without saving) |
| GET / POST | `/commission-schemes`; GET / PUT `/commission-schemes/:id` (PUT = new version with `applyTo` and `reason`); POST `/commission-schemes/:id/preview` |
| POST | `/tenants/:id/referral/terms` (new dated terms version) |

Also: replace the hard-coded CASE in `getPlatformStats` with a real `SUM(net_paise - refunded_paise)` for the current month, and make `getPlans` read from the `plans` table.

### Promoter auth (`promoter.auth.middleware.js`)
- Tokens are signed with the same `generateToken` but carry `typ: 'promoter'` and `sub: promoterId`; staff tokens get `typ: 'staff'`.
- `requirePromoter`: verify JWT → require `typ === 'promoter'` → look up `promoter_sessions` by sha256 hash and `expires_at > now()` → require promoter `status = 'active'` → set `req.promoter = { id, name, code }`.
- Defense in depth: in `requireAuth`, reject any token whose `typ === 'promoter'`. (A promoter token would already fail because it has no `auth_sessions` row, but make it explicit.)
- **Never accept `promoter_id` from the request.** Every partner query is `WHERE promoter_id = req.promoter.id`.

---

## 8. Promoter dashboard (frontend)

Separate area so staff and promoter sessions never mix:

```
frontend/src/partner/
  PartnerApp routes:  /partner/login, /partner/apply, /partner/reset-password,
                      /partner (overview), /partner/clinics, /partner/earnings,
                      /partner/payouts, /partner/profile
  partner.api.js      own axios instance + own token key (rai_partner_token)
  PartnerLayout.jsx, PartnerRoute.jsx
```
Add these routes in `App.jsx` **outside** the staff `PrivateRoute`/`Layout` tree.

**Overview**
- Referral link with Copy, Share on WhatsApp (`https://wa.me/?text=…`), and a QR code.
- KPI cards: Clinics referred · Active paying clinics · Awaiting activation · This month's earnings · Available balance · Pending (on hold) · Lifetime paid.
- Line chart: monthly earnings, last 12 months (recharts).
- Next payout date and minimum threshold progress.

**Clinics** — table: clinic name, city, plan, status (Awaiting approval / Active / Suspended), joined, commission window end, earned to date. Promoters see **no patient, conversation, booking or contact data** of the clinic.

**Earnings** — ledger: date, clinic, payment period, base, rate, amount, status (On hold until DD MMM / Available / Paid / Reversed), filters, CSV export.

**Payouts** — month, gross, TDS, net, status, UTR, paid date, PDF statement.

**Profile** — contact details, payout method (UPI or bank), PAN (masked), KYC status, agreement version accepted, change password.

Super admin UI additions — a new **Promoter Program** section with tabs:
- **Overview**: totals owed, on hold, paid this month, top promoters, pending applications and flags.
- **Settings**: grouped forms (General, Promoters, Attribution, Commission base, Hold, Payouts, Tax, Policies, Agreement, Notifications) generated from `/settings/schema`, so a new option shows up without new UI code. Each field shows its help text and when the change applies. Save asks for a reason and shows the impact preview for risky changes. A **History** drawer shows versions with a diff and "Restore this version" (saves as a new version).
- **Schemes**: list, create, edit (base rate, duration, per-plan rates, tier table editor, tier mode, bonus, cap), "who uses this scheme", version history, and the "new referrals only / existing from date" choice with preview.
- **Promoters**: applications, active list, detail page with scheme and overrides, KYC review, referrals and ledger.
- **Payouts**: run, review drafts, approve, export, mark paid.
- `TenantEdit.jsx`: **Referral** panel (who referred, dated terms versions, "change terms from date", window, reassign/revoke with reason) and **Payments** panel (record payment, refund, void, history).
- `Onboarding.jsx`: referral code field + `?ref` capture; `Landing.jsx`: `?ref` capture and a "Become a partner" link.
- `Settings.jsx` Billing tab: show the clinic its own payment history from `subscription_payments` (nice side-benefit).

---

## 9. Security and privacy checklist

- Separate identity, sessions, JWT `typ`, middleware, route prefix and frontend token storage (§7).
- Row-level scoping by `req.promoter.id` on every partner query; add a test that promoter A cannot read promoter B's clinics/ledger/payouts (IDOR).
- Bank account numbers encrypted with `secretBox`; only last 4 digits returned. PAN masked in responses (`ABCDE****F`).
- No patient data exposure to promoters (important under India's DPDP Act). Mention promoter data sharing in clinic Terms.
- `authLimiter` on apply/login/reset/code-check; generic error messages (no "email exists" leaks).
- Every super admin money/attribution action writes `promoter_audit_logs` with before/after and reason.
- Money changes only inside DB transactions; ledger guarded by the trigger in §4.
- Crons take `pg_try_advisory_lock(<constant>)` so a second PM2 instance (or overlapping run) cannot double-process.
- Sentry: make sure `sentryScrub` also drops PAN, bank and UPI fields.

## 10. Fraud controls

| Risk | Control |
|---|---|
| Promoter signs up their own / a family clinic | Email/phone match → `flagged`; super admin must clear it |
| Fake clinics to earn commission | Commission only on **real collected payments** + 30-day hold; refunds reverse |
| Churn-and-rejoin to reset the window | Window anchored to the first payment of the referral; new tenants with a WhatsApp number / owner email / phone seen before are flagged |
| Two promoters claim one clinic | Code captured at signup wins; disputes handled by super admin reassignment (future payments only, audited) |
| Code brute-forcing | Non-sequential codes, rate-limited validation endpoint, minimal response |
| Inside error / tampering | Append-only ledger, audit log, immutable amounts, two-step payout (draft → approved → paid) |

---

## 11. Edge-case checklist (each should have a test)

- [ ] Signup with invalid / inactive / lowercase / whitespace-padded code
- [ ] Signup with no code → no referral row
- [ ] Self-referral → `flagged`, commissions accrue but never release until cleared
- [ ] Tenant stays `pending` forever → zero commission
- [ ] First payment sets the window; later payments respect it
- [ ] Annual prepayment straddling the window end → prorated
- [ ] Payment fully outside the window → no entry
- [ ] Lifetime referral (`commission_months` NULL)
- [ ] GST-inclusive payment → GST excluded from base
- [ ] Same UTR recorded twice → rejected
- [ ] Accrual called twice for one payment → single entry
- [ ] Partial refund before hold ends → reversal, net balance correct
- [ ] Full refund after payout → negative balance carried forward, no negative payout
- [ ] Promoter suspended mid-hold → no release; reinstated → releases
- [ ] Promoter terminated → unpaid entries voided per agreement
- [ ] Rate changed on promoter or scheme with "new referrals only" → existing referrals unchanged
- [ ] Scheme change "existing from date" → payments with a period before that date use old terms, after it new terms; the date can't be before an already paid payout
- [ ] Tier mode live: promoter crosses a threshold → only payments after the monthly tier evaluation use the new rate
- [ ] Tier mode locked: tier change doesn't affect clinics already referred
- [ ] Per-plan rate beats tier and base rate; referral override beats everything
- [ ] Hold period changed → existing pending entries keep their `available_at`
- [ ] TDS rate changed → past payouts keep the rate they stored
- [ ] Invalid settings (negative rate, rate > 50%, tier thresholds not increasing) rejected by the server even if the UI is bypassed
- [ ] Two admins saving settings at the same time → second save gets a conflict (save sends the version it edited; server rejects if it's no longer current)
- [ ] Freeze accruals on → payments record but no entries; off → reconciliation creates the missed entries once
- [ ] New agreement version → promoter must accept before using the dashboard; acceptance recorded
- [ ] Referral reassigned → old entries stay, new payments go to new promoter
- [ ] Tenant deleted → ledger and statements intact (names from snapshot)
- [ ] Balance below minimum → no payout, carried forward
- [ ] Payout marked failed → entries return to `available`
- [ ] Cron run twice concurrently → no duplicates
- [ ] Month boundaries computed in Asia/Kolkata
- [ ] Promoter A cannot access promoter B's data; promoter token rejected by staff APIs and vice versa

## 12. Testing plan

- Add `npm test` → `node --test backend/test` (built into Node, no new dependency).
- **Unit**: `utils/money.js` (overlap days, proration, floor rounding with BigInt), commission calculation table-driven from §5 examples.
- **Integration** (against a disposable Postgres, `DATABASE_URL_TEST`): run all migrations, then the scenarios in §11 end to end through the services.
- **API**: auth separation and IDOR tests with supertest-style calls (or plain `fetch` against the app).
- **Shadow month**: before paying anyone, run the program for one month in shadow mode (accrue, do not pay), and reconcile the ledger against a manual spreadsheet.

## 13. Rollout phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Billing foundation** | `plans` table as single price source; `subscription_payments`; super admin "Record payment" UI; real revenue stats; clinic billing history | All active clinics' current payments recorded; stats match bank statement |
| **1. Configuration, promoter identity and attribution** | Settings + schemes tables, settings schema, admin Settings and Schemes screens with history and preview; `promoters`, sessions, apply/approve, partner login, `?ref` capture, onboarding field, `tenant_referrals` + `referral_terms`, admin assign/reassign, audit log | Test promoter can refer a test clinic end to end |
| **2. Commission engine** | Ledger, accrual in payment transaction, refunds/voids, daily release cron, reconciliation | All §11 money tests pass; shadow mode on |
| **3. Promoter dashboard** | Overview, clinics, earnings, profile/KYC | Pilot with 2–3 trusted promoters |
| **4. Payouts** | Monthly drafts, approval, CSV export, mark paid, PDF statements, emails, TDS field | First real payout reconciled |
| **5. Automation** | Payment-gateway subscriptions + webhook writing `subscription_payments`; click/funnel analytics | Manual payment entry no longer needed |

Gate everything behind the "Program enabled" setting. Existing clinics referred informally can be attached by a super admin with `source = 'admin_assigned'` before Phase 2 goes live.

## 14. Housekeeping found while reading the code

- Plan prices disagree: onboarding API and `constants` use 2,999 / 5,999 / 9,999; `PricingCalculator` uses 2,499 / 4,999 / 8,999; stats hard-codes its own CASE. Phase 0 removes the duplicates.
- `backend/src/database/migrations/` is not executed by `migrate.js` (it reads `backend/database/migrations/`); consider removing or documenting it to avoid confusion.
- `audit_logs` rows disappear when a tenant is deleted (cascade); keep that in mind for anything compliance-related.

## 15. Starting values to seed (all editable later in the admin panel)

Because every rule is configurable, nothing here blocks development. These are only the values to seed in settings v1 and the "Standard" scheme:

1. Base rate and duration (proposed 20% / 12 months) and whether to start with tiers.
2. Whether GST is charged on subscriptions today, and how clinics pay now (UPI, bank transfer) — this decides the Phase 0 payment form.
3. Whether existing clinics should be attached to promoters retroactively (uses late attribution or admin assignment).
4. Hold period, payout day and minimum payout.
5. TDS and GST values for payouts — confirm with your CA before the first payout.
6. The first version of the partner agreement text.

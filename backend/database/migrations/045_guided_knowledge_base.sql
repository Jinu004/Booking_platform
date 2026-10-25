-- Guided clinic knowledge base: data layer only (nothing reads these tables yet; the AI is not changed by this migration).
--   tenant_settings.ai_faq      the clinic's short answers (phone, address, policies, ...) as one JSON object
--   clinic_treatments           the clinic's treatments / services with an optional price text
--   clinic_offers               time-limited offers with their own questions and answers
--   unanswered_questions        questions the assistant could not answer, for staff to review
-- Safe to run twice (IF NOT EXISTS everywhere). Additive only.
BEGIN;

ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS ai_faq jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS clinic_treatments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  price_text VARCHAR(60),
  details VARCHAR(300),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clinic_treatments_tenant_active_sort ON clinic_treatments (tenant_id, is_active, sort_order);

CREATE TABLE IF NOT EXISTS clinic_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  details VARCHAR(500),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  qa JSONB NOT NULL DEFAULT '[]'::jsonb,
  poster_request_id UUID REFERENCES poster_requests(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_clinic_offers_tenant_active_dates ON clinic_offers (tenant_id, is_active, start_date, end_date);

CREATE TABLE IF NOT EXISTS unanswered_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question VARCHAR(300) NOT NULL,
  conversation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_unanswered_questions_tenant_resolved_created ON unanswered_questions (tenant_id, resolved_at, created_at DESC);

COMMIT;

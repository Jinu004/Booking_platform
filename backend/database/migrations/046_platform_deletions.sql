-- Recorded clinic offboarding: one row per deletion request. The row survives the deletion of the clinic (no foreign key to tenants)
-- and holds no personal data: the business name, plan, industry, dates, counts and the last error text.
--   collected  ids needed to finish a deletion that failed half way (conversation and campaign ids, the clinic's WhatsApp number);
--              the offboarding code sets it to NULL when the deletion completes, so a completed row holds none of them.
-- One open (not completed) request per clinic. Safe to run twice. Additive only.
BEGIN;

CREATE TABLE IF NOT EXISTS platform_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  tenant_name TEXT NOT NULL,
  plan TEXT,
  industry TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested_by UUID,
  suspended_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'in_progress', 'completed', 'failed')),
  counts JSONB,
  files_deleted INTEGER,
  redis_keys_deleted INTEGER,
  last_error TEXT,
  notes TEXT,
  collected JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_deletions_one_open_per_tenant ON platform_deletions (tenant_id) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_platform_deletions_due_at ON platform_deletions (due_at);

COMMIT;

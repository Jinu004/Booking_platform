-- 026_schema_reconciliation.sql
-- Idempotent reconciliation of all columns referenced in application code
-- but missing from the live schema. Safe to re-run: ADD COLUMN IF NOT EXISTS.
-- No DROPs, no ALTERs of existing columns, no data changes.

-- ============================================================
-- conversations
-- ============================================================

-- Live error: hitl.service.js sets/reads this on every HITL handoff
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- clinic_profiles
-- ============================================================

-- ai.executor.js get_clinic_info: SELECT cp.clinic_name as name
ALTER TABLE clinic_profiles
  ADD COLUMN IF NOT EXISTS clinic_name VARCHAR(255);

-- ai.executor.js get_clinic_info: SELECT cp.working_hours
ALTER TABLE clinic_profiles
  ADD COLUMN IF NOT EXISTS working_hours TEXT;

-- ai.executor.js get_clinic_info: SELECT cp.phone as whatsapp_number
ALTER TABLE clinic_profiles
  ADD COLUMN IF NOT EXISTS phone VARCHAR(20);

-- ============================================================
-- Previously patched manually — included for completeness
-- All four already exist; IF NOT EXISTS makes these no-ops.
-- ============================================================

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS patient_name VARCHAR(255);

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS ip_address TEXT;

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS user_agent TEXT;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;

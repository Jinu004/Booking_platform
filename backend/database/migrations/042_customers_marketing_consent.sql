-- Marketing consent per customer (one phone number at one clinic).
-- marketing_consent NULL = never asked. 'all' = checkups and offers, 'checkups' = checkup reminders only, 'none' = neither.
-- consent_asked_at is the once-only claim for the first-booking consent message.
BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS marketing_consent TEXT CHECK (marketing_consent IN ('all', 'checkups', 'none')),
  ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_source TEXT,
  ADD COLUMN IF NOT EXISTS consent_asked_at TIMESTAMPTZ;

COMMIT;

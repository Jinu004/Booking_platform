-- Live queue for appointments: when the patient arrived and when the consultation started (both NULL until staff set them).
-- Additive only: two nullable columns, no default, existing rows and queries are unchanged.
BEGIN;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS arrived_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS consult_started_at timestamptz;

COMMIT;

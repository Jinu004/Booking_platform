-- Time of the patient's last inbound message on each conversation (used by the 24-hour WhatsApp window check).
-- messages.created_at is "timestamp without time zone" holding UTC wall-clock time (the database time zone is UTC),
-- so the backfill converts it explicitly with AT TIME ZONE 'UTC'.
BEGIN;

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ NULL;

UPDATE conversations c
SET last_inbound_at = latest.last_user_at
FROM (
  SELECT conversation_id, MAX(created_at) AT TIME ZONE 'UTC' AS last_user_at
  FROM messages
  WHERE role = 'user'
  GROUP BY conversation_id
) latest
WHERE latest.conversation_id = c.id;

COMMIT;

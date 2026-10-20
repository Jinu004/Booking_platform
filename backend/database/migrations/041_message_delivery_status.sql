-- Delivery tracking for messages we send: the Meta message id, and whether Meta accepted or later reported a failure.
-- Additive only. wa_message_id is never returned to the browser.
BEGIN;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS wa_message_id TEXT,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT,
  ADD COLUMN IF NOT EXISTS delivery_error TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_wa_message_id ON messages (wa_message_id) WHERE wa_message_id IS NOT NULL;

COMMIT;

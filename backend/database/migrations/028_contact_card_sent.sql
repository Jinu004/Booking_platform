-- Add contact_card_sent flag to track one-time clinic contact card delivery
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS contact_card_sent BOOLEAN NOT NULL DEFAULT false;

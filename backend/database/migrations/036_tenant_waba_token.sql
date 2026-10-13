ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS whatsapp_waba_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS whatsapp_access_token_enc TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_connected_at TIMESTAMPTZ;

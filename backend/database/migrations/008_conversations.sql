CREATE TABLE IF NOT EXISTS conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id      UUID REFERENCES customers(id),
  channel          VARCHAR(20) NOT NULL DEFAULT 'whatsapp',
  status           VARCHAR(20) DEFAULT 'active',
  assigned_to      UUID REFERENCES staff(id),
  session_data     JSONB,
  started_at       TIMESTAMP DEFAULT NOW(),
  last_message_at  TIMESTAMP DEFAULT NOW()
);

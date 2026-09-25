CREATE TABLE IF NOT EXISTS whatsapp_retry_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  to_number VARCHAR(20) NOT NULL,
  message_type VARCHAR(20) NOT NULL DEFAULT 'text',
  payload JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_attempted_at TIMESTAMP,
  next_retry_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_retry_queue_status_next ON whatsapp_retry_queue(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_retry_queue_tenant ON whatsapp_retry_queue(tenant_id);

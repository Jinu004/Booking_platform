CREATE TABLE IF NOT EXISTS send_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  ctx TEXT,
  template_name TEXT,
  meta_code INTEGER,
  meta_subcode INTEGER,
  http_status INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_send_failures_tenant_created ON send_failures(tenant_id, created_at DESC);

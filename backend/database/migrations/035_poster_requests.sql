CREATE TABLE IF NOT EXISTS poster_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  caption TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_poster_requests_tenant_id ON poster_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_poster_requests_status ON poster_requests(status);

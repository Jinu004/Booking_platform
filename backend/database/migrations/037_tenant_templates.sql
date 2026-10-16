CREATE TABLE IF NOT EXISTS tenant_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  category TEXT NOT NULL,
  meta_template_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, name, language)
);

CREATE INDEX IF NOT EXISTS idx_tenant_templates_tenant_id ON tenant_templates(tenant_id);

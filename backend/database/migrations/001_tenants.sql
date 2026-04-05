CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(255) NOT NULL,
  slug             VARCHAR(100) UNIQUE NOT NULL,
  industry         VARCHAR(50) NOT NULL,
  plan             VARCHAR(20) DEFAULT 'starter',
  status           VARCHAR(20) DEFAULT 'active',
  whatsapp_number  VARCHAR(20) UNIQUE,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_configs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key              VARCHAR(100) NOT NULL,
  value            TEXT NOT NULL,
  UNIQUE(tenant_id, key)
);

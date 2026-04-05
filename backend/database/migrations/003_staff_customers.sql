CREATE TABLE IF NOT EXISTS staff (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  role             VARCHAR(50) NOT NULL,
  email            VARCHAR(255),
  phone            VARCHAR(20),
  clerk_user_id    VARCHAR(255),
  is_active        BOOLEAN DEFAULT true,
  created_at       TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             VARCHAR(255),
  phone            VARCHAR(20) NOT NULL,
  email            VARCHAR(255),
  date_of_birth    DATE,
  notes            TEXT,
  last_seen        TIMESTAMP,
  created_at       TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, phone)
);

CREATE TABLE IF NOT EXISTS clinic_doctors (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  specialization   VARCHAR(100),
  phone            VARCHAR(20),
  email            VARCHAR(255),
  qualification    VARCHAR(255),
  available_today  BOOLEAN DEFAULT true,
  leave_days       INTEGER DEFAULT 0,
  max_tokens_daily INTEGER DEFAULT 30,
  consultation_fee NUMERIC(10,2),
  created_at       TIMESTAMP DEFAULT NOW()
);

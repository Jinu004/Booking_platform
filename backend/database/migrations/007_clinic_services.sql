CREATE TABLE IF NOT EXISTS clinic_services (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  name             VARCHAR(255) NOT NULL,
  duration_minutes INTEGER DEFAULT 10,
  fee              NUMERIC(10,2),
  is_active        BOOLEAN DEFAULT true
);

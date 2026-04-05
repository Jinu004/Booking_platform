CREATE TABLE IF NOT EXISTS doctor_leaves (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  doctor_id        UUID REFERENCES clinic_doctors(id),
  leave_date       DATE NOT NULL,
  reason           VARCHAR(255),
  created_at       TIMESTAMP DEFAULT NOW()
);

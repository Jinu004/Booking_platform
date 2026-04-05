CREATE TABLE IF NOT EXISTS doctor_schedules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  doctor_id        UUID NOT NULL REFERENCES clinic_doctors(id),
  day_of_week      INTEGER NOT NULL,
  start_time       TIME NOT NULL,
  end_time         TIME NOT NULL,
  is_available     BOOLEAN DEFAULT true
);

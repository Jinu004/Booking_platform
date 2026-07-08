-- procedures table: stores procedure types per doctor with duration
CREATE TABLE IF NOT EXISTS procedures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES clinic_doctors(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  duration_minutes INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_procedures_tenant_doctor ON procedures(tenant_id, doctor_id);

-- schedule_overrides table: per-date session overrides for a doctor
CREATE TABLE IF NOT EXISTS schedule_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES clinic_doctors(id) ON DELETE CASCADE,
  override_date DATE NOT NULL,
  sessions JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(doctor_id, override_date)
);
CREATE INDEX IF NOT EXISTS idx_schedule_overrides_doctor_date ON schedule_overrides(tenant_id, doctor_id, override_date);

-- add booking_type to bookings table
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_type VARCHAR(20) DEFAULT 'normal';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS procedure_id UUID REFERENCES procedures(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS end_time VARCHAR(10);

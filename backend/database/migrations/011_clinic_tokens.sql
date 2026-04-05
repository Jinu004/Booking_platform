CREATE TABLE IF NOT EXISTS clinic_tokens (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id          UUID REFERENCES bookings(id),
  doctor_id           UUID REFERENCES clinic_doctors(id),
  token_number        INTEGER NOT NULL,
  status              VARCHAR(20) DEFAULT 'waiting',
  issued_at           TIMESTAMP DEFAULT NOW(),
  consultation_start  TIMESTAMP,
  consultation_end    TIMESTAMP
);

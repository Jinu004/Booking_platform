CREATE TABLE IF NOT EXISTS clinic_profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  address          TEXT,
  city             VARCHAR(100),
  pincode          VARCHAR(10),
  opening_time     TIME NOT NULL DEFAULT '09:00',
  closing_time     TIME NOT NULL DEFAULT '20:00',
  lunch_start      TIME,
  lunch_end        TIME,
  weekly_off       VARCHAR(20) DEFAULT 'sunday',
  registration_no  VARCHAR(100),
  gstin            VARCHAR(20)
);

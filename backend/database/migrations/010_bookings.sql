CREATE TABLE IF NOT EXISTS bookings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id      UUID REFERENCES customers(id),
  conversation_id  UUID REFERENCES conversations(id),
  doctor_id        UUID REFERENCES clinic_doctors(id),
  source           VARCHAR(20) DEFAULT 'whatsapp',
  status           VARCHAR(20) DEFAULT 'pending',
  booking_date     DATE NOT NULL,
  slot_time        VARCHAR(10),
  token_number     INTEGER,
  notes            TEXT,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

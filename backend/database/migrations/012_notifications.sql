CREATE TABLE IF NOT EXISTS notifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id       UUID REFERENCES bookings(id),
  customer_id      UUID REFERENCES customers(id),
  type             VARCHAR(50) NOT NULL,
  channel          VARCHAR(20) DEFAULT 'whatsapp',
  status           VARCHAR(20) DEFAULT 'scheduled',
  scheduled_at     TIMESTAMP NOT NULL,
  sent_at          TIMESTAMP,
  created_at       TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  working_hours JSONB DEFAULT '{}',
  handoff_message TEXT DEFAULT 'Let me connect you with a staff member.',
  out_of_hours_message TEXT DEFAULT 'We are currently closed.',
  ai_knowledge_base TEXT DEFAULT '',
  language VARCHAR(20) DEFAULT 'english',
  business_address TEXT DEFAULT '',
  business_phone VARCHAR(20) DEFAULT '',
  business_email VARCHAR(100) DEFAULT '',
  payment_upi VARCHAR(100) DEFAULT '',
  payment_phone VARCHAR(20) DEFAULT '',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(tenant_id)
);
GRANT ALL PRIVILEGES ON TABLE tenant_settings TO appuser;

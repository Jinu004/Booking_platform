BEGIN;

-- 1. Add mode to conversations
ALTER TABLE conversations
  ADD COLUMN mode VARCHAR(10) NOT NULL DEFAULT 'ai'
    CHECK (mode IN ('ai', 'human')),
  ADD COLUMN mode_changed_at TIMESTAMP,
  ADD COLUMN mode_changed_by UUID REFERENCES staff(id) ON DELETE SET NULL;

CREATE INDEX idx_conversations_mode ON conversations(tenant_id, mode);

-- 2. Create tenant_settings table
CREATE TABLE IF NOT EXISTS tenant_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  working_hours JSONB NOT NULL DEFAULT '{
    "mon": {"open": "09:00", "close": "18:00", "enabled": true},
    "tue": {"open": "09:00", "close": "18:00", "enabled": true},
    "wed": {"open": "09:00", "close": "18:00", "enabled": true},
    "thu": {"open": "09:00", "close": "18:00", "enabled": true},
    "fri": {"open": "09:00", "close": "18:00", "enabled": true},
    "sat": {"open": "09:00", "close": "14:00", "enabled": true},
    "sun": {"open": "09:00", "close": "14:00", "enabled": false}
  }',
  handoff_message TEXT NOT NULL DEFAULT 'Please hold on, I am connecting you with our staff.',
  out_of_hours_message TEXT NOT NULL DEFAULT 'Our clinic is currently closed. We will get back to you during working hours.',
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id)
);

-- 3. Insert default settings for all existing tenants
INSERT INTO tenant_settings (tenant_id)
SELECT id FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

COMMIT;

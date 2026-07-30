ALTER TABLE conversations ADD COLUMN IF NOT EXISTS mode VARCHAR(10) NOT NULL DEFAULT 'ai';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS mode_changed_at TIMESTAMP;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS mode_changed_by UUID;
ALTER TABLE conversations ADD CONSTRAINT IF NOT EXISTS conversations_mode_check CHECK (mode IN ('ai', 'human'));
CREATE INDEX IF NOT EXISTS idx_conversations_mode ON conversations(tenant_id, mode);

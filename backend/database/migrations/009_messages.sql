CREATE TABLE IF NOT EXISTS messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             VARCHAR(20) NOT NULL,
  content          TEXT NOT NULL,
  type             VARCHAR(20) DEFAULT 'text',
  created_at       TIMESTAMP DEFAULT NOW()
);

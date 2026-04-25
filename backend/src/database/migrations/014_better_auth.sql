ALTER TABLE staff
ADD COLUMN IF NOT EXISTS password_hash TEXT,
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN
  DEFAULT false,
ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES staff(id)
    ON DELETE CASCADE,
  tenant_id UUID NOT NULL
    REFERENCES tenants(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS
  idx_auth_sessions_token
  ON auth_sessions(token);

CREATE INDEX IF NOT EXISTS
  idx_auth_sessions_staff_id
  ON auth_sessions(staff_id);

CREATE TABLE IF NOT EXISTS
  auth_password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id)
    ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

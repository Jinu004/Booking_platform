ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS token_hash TEXT;
DELETE FROM auth_sessions;
ALTER TABLE auth_sessions ALTER COLUMN token_hash SET NOT NULL;
ALTER TABLE auth_sessions DROP COLUMN token;
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(token_hash);
DROP INDEX IF EXISTS idx_auth_sessions_token;

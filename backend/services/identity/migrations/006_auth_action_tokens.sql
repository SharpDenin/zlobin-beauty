-- AUTH-01 / AUTH-02: one-time action tokens (password reset, email verify).
-- Only token hashes are stored. Plain tokens never persist.
--
-- Rollback:
--   DROP TABLE IF EXISTS auth_action_tokens;

CREATE TABLE IF NOT EXISTS auth_action_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL
    CHECK (purpose IN ('password_reset', 'email_verify')),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS auth_action_tokens_user_purpose_active_idx
  ON auth_action_tokens (user_id, purpose, created_at DESC)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS auth_action_tokens_expires_idx
  ON auth_action_tokens (expires_at)
  WHERE used_at IS NULL;

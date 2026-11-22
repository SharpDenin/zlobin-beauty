-- Master → client QR / link invitations. Plaintext token is never stored.
CREATE TABLE IF NOT EXISTS client_invites (
    id UUID PRIMARY KEY,
    master_user_id UUID NOT NULL,
    organization_id UUID,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    max_uses INT NOT NULL DEFAULT 20 CHECK (max_uses > 0),
    use_count INT NOT NULL DEFAULT 0 CHECK (use_count >= 0),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT client_invites_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS client_invites_master_idx ON client_invites (master_user_id, created_at DESC);

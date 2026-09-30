-- Salon QR / link invitations. Token plaintext is never stored.
CREATE TABLE IF NOT EXISTS salon_invites (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by UUID NOT NULL,
    role TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    max_uses INT NOT NULL DEFAULT 10 CHECK (max_uses > 0),
    use_count INT NOT NULL DEFAULT 0 CHECK (use_count >= 0),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT salon_invites_token_hash_key UNIQUE (token_hash),
    CONSTRAINT salon_invites_role_check CHECK (role IN ('master', 'admin', 'staff'))
);

CREATE INDEX IF NOT EXISTS salon_invites_org_idx ON salon_invites (organization_id, created_at DESC);

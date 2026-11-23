-- One successful accept per client invite (one-time QR ledger + history).
CREATE TABLE IF NOT EXISTS client_invite_accepts (
    id UUID PRIMARY KEY,
    invite_id UUID NOT NULL REFERENCES client_invites(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL,
    display_name_snapshot TEXT NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT client_invite_accepts_invite_unique UNIQUE (invite_id)
);

CREATE INDEX IF NOT EXISTS client_invite_accepts_user_idx ON client_invite_accepts (user_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS client_invite_accepts_invite_idx ON client_invite_accepts (invite_id);

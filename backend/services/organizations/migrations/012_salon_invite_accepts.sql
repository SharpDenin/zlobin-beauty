-- One successful accept per salon invite (one-time QR ledger + history).
CREATE TABLE IF NOT EXISTS salon_invite_accepts (
    id UUID PRIMARY KEY,
    invite_id UUID NOT NULL REFERENCES salon_invites(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL,
    role TEXT NOT NULL,
    display_name_snapshot TEXT NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT salon_invite_accepts_invite_unique UNIQUE (invite_id)
);

CREATE INDEX IF NOT EXISTS salon_invite_accepts_user_idx ON salon_invite_accepts (user_id, accepted_at DESC);

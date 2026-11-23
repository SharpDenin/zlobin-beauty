-- Client-QR referral program: 10 qualified invitees → +3 months Premium for inviter.
CREATE TABLE IF NOT EXISTS referral_links (
    id UUID PRIMARY KEY,
    inviter_user_id UUID NOT NULL REFERENCES users(id),
    invitee_user_id UUID NOT NULL REFERENCES users(id),
    client_invite_id UUID NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL,
    qualified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT referral_links_invitee_unique UNIQUE (invitee_user_id),
    CONSTRAINT referral_links_no_self CHECK (inviter_user_id <> invitee_user_id)
);

CREATE INDEX IF NOT EXISTS referral_links_inviter_idx
    ON referral_links (inviter_user_id, qualified_at);

CREATE TABLE IF NOT EXISTS referral_rewards (
    id UUID PRIMARY KEY,
    inviter_user_id UUID NOT NULL REFERENCES users(id),
    batch_number INT NOT NULL CHECK (batch_number > 0),
    qualified_count_at_grant INT NOT NULL,
    months_granted INT NOT NULL DEFAULT 3,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT referral_rewards_batch_unique UNIQUE (inviter_user_id, batch_number)
);

CREATE INDEX IF NOT EXISTS referral_rewards_inviter_idx
    ON referral_rewards (inviter_user_id, batch_number DESC);

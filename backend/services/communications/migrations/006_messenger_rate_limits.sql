-- MSG-03: durable per-user messenger rate-limit events (multi-instance safe).
CREATE TABLE IF NOT EXISTS messenger_rate_events (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('conversation_create', 'first_message')),
    conversation_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messenger_rate_events_user_kind_created_idx
  ON messenger_rate_events (user_id, kind, created_at DESC);

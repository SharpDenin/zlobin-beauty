CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    user_id UUID NOT NULL,
    operation TEXT NOT NULL,
    request_hash TEXT NOT NULL DEFAULT '',
    response_status INT NOT NULL DEFAULT 0,
    response_body JSONB,
    entity_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idempotency_keys_expires_idx ON idempotency_keys(expires_at);

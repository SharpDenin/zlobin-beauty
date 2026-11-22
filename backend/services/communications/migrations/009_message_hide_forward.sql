-- Per-user message hide (delete for me) and forward attribution.
-- Global messages.deleted_at remains unused by product APIs (reserved for future delete-for-all).

CREATE TABLE IF NOT EXISTS message_hides (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    hidden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS message_hides_user_idx
    ON message_hides (user_id, hidden_at DESC);

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS forwarded_from_message_id UUID,
    ADD COLUMN IF NOT EXISTS forwarded_from_sender_user_id UUID;

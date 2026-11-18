-- Client-generated idempotency key for outbound messages (optimistic UI / retries).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS messages_conversation_sender_client_uidx
  ON messages (conversation_id, sender_user_id, client_id)
  WHERE client_id IS NOT NULL AND length(trim(client_id)) > 0;

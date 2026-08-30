-- Chat attachments: kind + optional media_id. Body may be empty when media is present.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_id UUID;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_kind_check CHECK (kind IN ('text', 'image', 'video'));

CREATE INDEX IF NOT EXISTS messages_media_idx ON messages (media_id) WHERE media_id IS NOT NULL;

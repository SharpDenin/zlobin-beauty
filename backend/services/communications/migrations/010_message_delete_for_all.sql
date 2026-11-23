-- Delete-for-all uses messages.deleted_at (soft delete).
-- Link notifications to message_id so server-side alerts can be redacted/removed.
-- Rollback:
--   DROP INDEX IF EXISTS notifications_message_idx;
--   ALTER TABLE notifications DROP COLUMN IF EXISTS message_id;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS message_id UUID;

CREATE INDEX IF NOT EXISTS notifications_message_idx
  ON notifications (message_id)
  WHERE message_id IS NOT NULL AND deleted_at IS NULL;

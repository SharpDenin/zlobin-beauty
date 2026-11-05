-- NOTIF-02: soft hide/delete for notifications (independent of read_at).
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS notifications_user_active_idx
  ON notifications (user_id, created_at DESC)
  WHERE deleted_at IS NULL;

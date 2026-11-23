-- Idempotent in-app notifications + push dispatch marker for resume-safe delivery.
-- Rollback:
--   DROP INDEX IF EXISTS notifications_idempotency_uidx;
--   ALTER TABLE notifications DROP COLUMN IF EXISTS push_dispatched_at;
--   ALTER TABLE notifications DROP COLUMN IF EXISTS idempotency_key;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS push_dispatched_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_idempotency_uidx
  ON notifications (idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

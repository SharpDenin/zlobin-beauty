-- Master must view client card before confirming (unless auto-confirm).
-- Rollback: DROP TABLE IF EXISTS appointment_card_views;

CREATE TABLE IF NOT EXISTS appointment_card_views (
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  master_user_id UUID NOT NULL,
  client_card_id UUID,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (appointment_id, master_user_id)
);

CREATE INDEX IF NOT EXISTS appointment_card_views_master_idx
  ON appointment_card_views (master_user_id, viewed_at DESC);

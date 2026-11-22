-- Allow assigned master to open client passport before first completed visit
-- (needed for confirm-after-card-view flow).
-- Rollback: DROP TABLE IF EXISTS client_card_master_grants;

CREATE TABLE IF NOT EXISTS client_card_master_grants (
  client_card_id UUID NOT NULL REFERENCES client_cards(id) ON DELETE CASCADE,
  master_user_id UUID NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_card_id, master_user_id)
);

CREATE INDEX IF NOT EXISTS client_card_master_grants_master_idx
  ON client_card_master_grants (master_user_id, granted_at DESC);

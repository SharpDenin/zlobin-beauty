-- Adjust / receipt idempotency reuses stock_movements.idempotency_key
-- (unique partial index stock_movements_idempotency_uidx from 014_master_inventory.sql).
-- Keys are scoped in application code as u:{actor}:loc:{location}:k:{clientKey}.
-- Retention: keys live with permanent audit rows; do not drop early (retry window = forever).
-- Index below supports optional operational review of recent idempotent writes.

CREATE INDEX IF NOT EXISTS stock_movements_idempotency_created_idx
    ON stock_movements (created_at DESC)
    WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

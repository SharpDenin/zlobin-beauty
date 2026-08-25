-- Phase 5: personal master warehouse scope, receipt disposition, movement idempotency.

-- One active master warehouse per (organization, owner user).
CREATE UNIQUE INDEX IF NOT EXISTS stock_locations_master_owner_uidx
    ON stock_locations (organization_id, owner_user_id)
    WHERE kind = 'master' AND owner_user_id IS NOT NULL;

ALTER TABLE stock_movements
    DROP CONSTRAINT IF EXISTS stock_movements_kind_check;

ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_kind_check
    CHECK (kind IN (
        'receipt', 'consumption', 'adjust', 'write_off', 'return',
        'reserve', 'unreserve', 'release', 'shipment',
        'damage', 'rejection'
    ));

ALTER TABLE stock_movements
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_idempotency_uidx
    ON stock_movements (idempotency_key)
    WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

ALTER TABLE supplier_order_items
    ADD COLUMN IF NOT EXISTS qty_damaged NUMERIC(12,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS qty_rejected NUMERIC(12,3) NOT NULL DEFAULT 0;

ALTER TABLE supplier_order_items
    DROP CONSTRAINT IF EXISTS supplier_order_items_disposition_nonneg;

ALTER TABLE supplier_order_items
    ADD CONSTRAINT supplier_order_items_disposition_nonneg
    CHECK (qty_damaged >= 0 AND qty_rejected >= 0 AND qty_accepted >= 0);

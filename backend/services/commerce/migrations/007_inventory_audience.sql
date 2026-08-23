-- Product audience, archive, extra stock movement kinds, warehouses, analytics indexes.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'all',
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE products
    DROP CONSTRAINT IF EXISTS products_audience_check;

ALTER TABLE products
    ADD CONSTRAINT products_audience_check
    CHECK (audience IN ('all', 'professional_only'));

CREATE INDEX IF NOT EXISTS products_audience_idx
    ON products(organization_id, audience)
    WHERE published AND for_sale AND archived_at IS NULL;

ALTER TABLE stock_locations
    ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS address_line TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
    ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE stock_movements
    DROP CONSTRAINT IF EXISTS stock_movements_kind_check;

ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_kind_check
    CHECK (kind IN (
        'receipt', 'consumption', 'adjust', 'write_off', 'return',
        'reserve', 'unreserve', 'release', 'shipment'
    ));

ALTER TABLE supplier_orders
    ADD COLUMN IF NOT EXISTS assigned_rep_user_id UUID;

CREATE INDEX IF NOT EXISTS supplier_orders_supplier_created_idx
    ON supplier_orders(supplier_org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS supplier_orders_supplier_payment_idx
    ON supplier_orders(supplier_org_id, payment_status, created_at DESC);

CREATE INDEX IF NOT EXISTS supplier_orders_assigned_rep_idx
    ON supplier_orders(assigned_rep_user_id, created_at DESC)
    WHERE assigned_rep_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS supplier_order_items_product_idx
    ON supplier_order_items(product_id);

ALTER TABLE order_deliveries
    ADD COLUMN IF NOT EXISTS assigned_rep_user_id UUID,
    ADD COLUMN IF NOT EXISTS collect_amount_minor BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS order_deliveries_rep_idx
    ON order_deliveries(assigned_rep_user_id, status)
    WHERE assigned_rep_user_id IS NOT NULL;

CREATE TABLE commerce_audit_events (
    id UUID PRIMARY KEY,
    organization_id UUID,
    actor_user_id UUID,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX commerce_audit_events_org_idx ON commerce_audit_events(organization_id, created_at DESC);

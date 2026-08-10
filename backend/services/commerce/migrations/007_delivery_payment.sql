-- Separate Order (commercial) vs Delivery (physical) + payment model.
-- Money remains BIGINT minor units. Destination is organizations.branches.

ALTER TABLE supplier_orders
    ADD COLUMN IF NOT EXISTS destination_branch_id UUID;

ALTER TABLE supplier_orders
    ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash';

ALTER TABLE supplier_orders
    ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE supplier_orders
    ADD COLUMN IF NOT EXISTS subtotal_minor BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0);

ALTER TABLE supplier_orders
    ADD COLUMN IF NOT EXISTS delivery_cost_minor BIGINT NOT NULL DEFAULT 0 CHECK (delivery_cost_minor >= 0);

ALTER TABLE supplier_orders
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

ALTER TABLE supplier_orders
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE supplier_orders
    DROP CONSTRAINT IF EXISTS supplier_orders_payment_method_check;

ALTER TABLE supplier_orders
    ADD CONSTRAINT supplier_orders_payment_method_check
    CHECK (payment_method IN ('cash', 'bank_transfer', 'card', 'invoice'));

ALTER TABLE supplier_orders
    DROP CONSTRAINT IF EXISTS supplier_orders_payment_status_check;

ALTER TABLE supplier_orders
    ADD CONSTRAINT supplier_orders_payment_status_check
    CHECK (payment_status IN (
        'pending', 'awaiting_payment', 'authorized', 'paid',
        'partially_paid', 'failed', 'refunded', 'cancelled'
    ));

-- Backfill subtotal from total for existing rows.
UPDATE supplier_orders SET subtotal_minor = total_minor WHERE subtotal_minor = 0 AND total_minor > 0;

CREATE UNIQUE INDEX IF NOT EXISTS supplier_orders_idempotency_key_uidx
    ON supplier_orders(created_by, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

CREATE INDEX IF NOT EXISTS supplier_orders_supplier_status_idx
    ON supplier_orders(supplier_org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS supplier_orders_destination_idx
    ON supplier_orders(destination_branch_id)
    WHERE destination_branch_id IS NOT NULL;

-- Snapshot product name on line items for historical display.
ALTER TABLE supplier_order_items
    ADD COLUMN IF NOT EXISTS product_name TEXT NOT NULL DEFAULT '';

ALTER TABLE supplier_order_items
    ADD COLUMN IF NOT EXISTS product_sku TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS order_deliveries (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
    supplier_org_id UUID NOT NULL,
    destination_branch_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    planned_delivery_at TIMESTAMPTZ,
    window_start TIMESTAMPTZ,
    window_end TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    recipient_name TEXT NOT NULL DEFAULT '',
    recipient_phone TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    tracking_code TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        status IN (
            'pending', 'scheduled', 'preparing', 'in_transit',
            'arrived', 'delivered', 'failed', 'cancelled'
        )
    ),
    CHECK (
        window_start IS NULL OR window_end IS NULL OR window_end > window_start
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS order_deliveries_one_active_per_order_uidx
    ON order_deliveries(order_id)
    WHERE status NOT IN ('cancelled', 'failed');

CREATE INDEX IF NOT EXISTS order_deliveries_destination_time_idx
    ON order_deliveries(destination_branch_id, planned_delivery_at);

CREATE INDEX IF NOT EXISTS order_deliveries_supplier_status_idx
    ON order_deliveries(supplier_org_id, status);

-- Expand order status CHECK to include commerce lifecycle aliases used by new code.
-- Existing: draft,new,confirmed,picking,in_transit,delivered,accepted_partial,accepted_full,cancelled
-- Added: processing, ready_for_dispatch, completed (map from picking/in_transit/delivered commercially)

ALTER TABLE supplier_orders DROP CONSTRAINT IF EXISTS supplier_orders_status_check;
ALTER TABLE supplier_orders ADD CONSTRAINT supplier_orders_status_check
CHECK (status IN (
    'draft', 'new', 'submitted', 'confirmed', 'processing', 'picking',
    'ready_for_dispatch', 'in_transit', 'delivered', 'completed',
    'accepted_partial', 'accepted_full', 'cancelled'
));

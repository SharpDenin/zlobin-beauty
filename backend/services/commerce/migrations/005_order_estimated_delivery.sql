ALTER TABLE supplier_orders
    ADD COLUMN IF NOT EXISTS estimated_delivery_at TIMESTAMPTZ;

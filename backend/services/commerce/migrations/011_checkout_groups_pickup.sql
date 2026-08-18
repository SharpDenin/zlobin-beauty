-- Multi-supplier checkout groups and salon pickup statuses.

CREATE TABLE client_checkout_groups (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL DEFAULT '',
  total_minor BIGINT NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX client_checkout_groups_idem_idx
  ON client_checkout_groups(user_id, idempotency_key)
  WHERE idempotency_key <> '';

ALTER TABLE client_orders
  ADD COLUMN IF NOT EXISTS checkout_group_id UUID REFERENCES client_checkout_groups(id);

CREATE INDEX client_orders_checkout_group_idx ON client_orders(checkout_group_id)
  WHERE checkout_group_id IS NOT NULL;

ALTER TABLE client_orders DROP CONSTRAINT IF EXISTS client_orders_status_check;
ALTER TABLE client_orders ADD CONSTRAINT client_orders_status_check CHECK (status IN (
  'submitted','confirmed','picking','in_delivery','delivered',
  'ready_for_pickup','received','cancelled'
));

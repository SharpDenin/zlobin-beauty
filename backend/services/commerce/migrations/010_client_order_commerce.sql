-- Client shop commerce: cart price snapshots, checkout idempotency, payment status.

ALTER TABLE client_cart_items
  ADD COLUMN IF NOT EXISTS price_minor BIGINT;

UPDATE client_cart_items ci
SET price_minor = p.price_minor
FROM products p
WHERE p.id = ci.product_id AND ci.price_minor IS NULL;

ALTER TABLE client_cart_items
  ALTER COLUMN price_minor SET DEFAULT 0;

ALTER TABLE client_orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS client_orders_idempotency_idx
  ON client_orders(user_id, idempotency_key)
  WHERE idempotency_key <> '';

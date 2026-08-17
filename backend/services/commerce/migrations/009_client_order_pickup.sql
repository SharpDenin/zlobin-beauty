ALTER TABLE client_orders
  ADD COLUMN IF NOT EXISTS pickup_branch_id UUID;
CREATE INDEX IF NOT EXISTS client_orders_pickup_idx ON client_orders(pickup_branch_id)
  WHERE pickup_branch_id IS NOT NULL;

-- Defence in depth for stock integrity: balances can never go negative and
-- reserved stock can never exceed on-hand stock. The application already
-- enforces this in store.computeMovement; a violation reaching Postgres is
-- mapped to the typed insufficient_stock (HTTP 409) error by store.MapStockError.
--
-- NOT VALID: the rule is enforced for every new/updated row without scanning or
-- rejecting legacy rows, so this migration cannot fail on existing data.
-- Once legacy rows are cleaned up it can be promoted with:
--   ALTER TABLE stock_balances VALIDATE CONSTRAINT stock_balances_qty_nonneg;
ALTER TABLE stock_balances DROP CONSTRAINT IF EXISTS stock_balances_qty_nonneg;
ALTER TABLE stock_balances
  ADD CONSTRAINT stock_balances_qty_nonneg
  CHECK (qty_on_hand >= 0 AND qty_reserved >= 0 AND qty_on_hand >= qty_reserved)
  NOT VALID;

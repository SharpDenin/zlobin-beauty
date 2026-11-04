-- SHOP-02: prevent duplicate full returns for the same client order.
-- Unique partial index on debt_ledger return_credit rows linked to a client_order.
--
-- Included in the standard commerce Migrate() runner (schema_migrations by filename).
-- Re-apply is a no-op once version `016_return_credit_unique.sql` is recorded.
-- CREATE UNIQUE INDEX IF NOT EXISTS is also idempotent if the statement is re-run.
--
-- Rollback (matches index name below):
--   DROP INDEX IF EXISTS debt_ledger_return_credit_client_order_uidx;

DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT ref_id
    FROM debt_ledger
    WHERE kind = 'return_credit'
      AND ref_type = 'client_order'
      AND ref_id IS NOT NULL
    GROUP BY ref_id
    HAVING COUNT(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION
      '016_return_credit_unique: % conflicting return_credit duplicate(s) for client_order — resolve before creating unique index',
      dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS debt_ledger_return_credit_client_order_uidx
  ON debt_ledger (ref_id)
  WHERE kind = 'return_credit' AND ref_type = 'client_order' AND ref_id IS NOT NULL;

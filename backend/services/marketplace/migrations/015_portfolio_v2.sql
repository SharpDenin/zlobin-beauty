-- Portfolio v2: richer metadata while keeping caption for backward compatibility.
ALTER TABLE portfolio_items
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'photo',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE portfolio_items
SET title = caption
WHERE (title IS NULL OR title = '') AND caption IS NOT NULL AND caption <> '';

UPDATE portfolio_items
SET updated_at = created_at
WHERE updated_at IS NULL OR updated_at < created_at;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portfolio_items_media_type_chk'
  ) THEN
    ALTER TABLE portfolio_items
      ADD CONSTRAINT portfolio_items_media_type_chk
      CHECK (media_type IN ('photo', 'gif', 'video'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS portfolio_master_category_idx
  ON portfolio_items (master_id, category, sort_order, created_at DESC);

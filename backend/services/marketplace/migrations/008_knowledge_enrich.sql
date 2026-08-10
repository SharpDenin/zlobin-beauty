ALTER TABLE knowledge_articles
    ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS product_id UUID,
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

UPDATE knowledge_articles
SET published_at = COALESCE(published_at, created_at)
WHERE published = TRUE AND published_at IS NULL;

-- Production knowledge base: lifecycle, relations, favorites, ranking signals.

ALTER TABLE knowledge_articles
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published',
    ADD COLUMN IF NOT EXISTS view_count INT NOT NULL DEFAULT 0 CHECK (view_count >= 0),
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

UPDATE knowledge_articles
SET status = CASE WHEN published THEN 'published' ELSE 'draft' END
WHERE status = 'published' AND published = FALSE;

ALTER TABLE knowledge_articles
    DROP CONSTRAINT IF EXISTS knowledge_articles_status_check;

ALTER TABLE knowledge_articles
    ADD CONSTRAINT knowledge_articles_status_check
    CHECK (status IN ('draft', 'published', 'archived'));

CREATE TABLE knowledge_article_products (
    article_id UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
    product_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (article_id, product_id)
);

CREATE INDEX knowledge_article_products_product_idx ON knowledge_article_products(product_id);

-- Backfill single product_id into M2M.
INSERT INTO knowledge_article_products(article_id, product_id)
SELECT id, product_id FROM knowledge_articles
WHERE product_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE knowledge_article_categories (
    article_id UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
    category_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (article_id, category_id)
);

CREATE INDEX knowledge_article_categories_cat_idx ON knowledge_article_categories(category_id);

CREATE TABLE knowledge_favorites (
    user_id UUID NOT NULL,
    article_id UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, article_id)
);

CREATE INDEX knowledge_favorites_article_idx ON knowledge_favorites(article_id);

CREATE INDEX knowledge_articles_status_idx
    ON knowledge_articles(status, published_at DESC NULLS LAST);

CREATE INDEX knowledge_articles_brand_idx
    ON knowledge_articles(brand)
    WHERE brand <> '';

CREATE INDEX knowledge_articles_search_idx
    ON knowledge_articles USING gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(category,'')));

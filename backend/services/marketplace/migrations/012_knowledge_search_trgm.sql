-- ILIKE search helpers for knowledge title/content (small catalog; not Elasticsearch).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS knowledge_articles_title_trgm_idx
    ON knowledge_articles USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS knowledge_articles_content_trgm_idx
    ON knowledge_articles USING gin (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS knowledge_articles_author_org_idx
    ON knowledge_articles (author_org_id)
    WHERE author_org_id IS NOT NULL;

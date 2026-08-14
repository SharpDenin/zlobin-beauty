-- Rich knowledge content: format + structured JSON body + cover media.

ALTER TABLE knowledge_articles
    ADD COLUMN IF NOT EXISTS content_format TEXT NOT NULL DEFAULT 'plain';

ALTER TABLE knowledge_articles
    DROP CONSTRAINT IF EXISTS knowledge_articles_content_format_check;

ALTER TABLE knowledge_articles
    ADD CONSTRAINT knowledge_articles_content_format_check
    CHECK (content_format IN ('plain', 'doc_json'));

ALTER TABLE knowledge_articles
    ADD COLUMN IF NOT EXISTS cover_media_id UUID;

ALTER TABLE knowledge_articles
    ADD COLUMN IF NOT EXISTS reading_time_minutes INT NOT NULL DEFAULT 0
        CHECK (reading_time_minutes >= 0);

CREATE INDEX IF NOT EXISTS knowledge_articles_supplier_published_idx
    ON knowledge_articles(author_org_id, published, published_at DESC NULLS LAST)
    WHERE published = true;

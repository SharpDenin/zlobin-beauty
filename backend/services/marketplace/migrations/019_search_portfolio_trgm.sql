-- SEARCH-02: accelerate ILIKE '%q%' over portfolio text fields used by master search.
-- pg_trgm already enabled by 012_knowledge_search_trgm.sql; IF NOT EXISTS keeps this idempotent.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS portfolio_items_title_trgm_idx
    ON portfolio_items USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS portfolio_items_caption_trgm_idx
    ON portfolio_items USING gin (caption gin_trgm_ops);

CREATE INDEX IF NOT EXISTS portfolio_items_description_trgm_idx
    ON portfolio_items USING gin (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS portfolio_items_category_trgm_idx
    ON portfolio_items USING gin (category gin_trgm_ops);

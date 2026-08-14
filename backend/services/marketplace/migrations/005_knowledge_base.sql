CREATE TABLE knowledge_articles (
    id UUID PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    author_user_id UUID NOT NULL,
    author_org_id UUID,
    author_name TEXT NOT NULL DEFAULT '',
    published BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX knowledge_articles_category_idx ON knowledge_articles(category);
CREATE INDEX knowledge_articles_published_idx ON knowledge_articles(published, created_at DESC);

CREATE TABLE portfolio_items (
  id UUID PRIMARY KEY,
  master_id UUID NOT NULL REFERENCES master_profiles(id) ON DELETE CASCADE,
  media_id UUID NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX portfolio_master_idx ON portfolio_items(master_id, sort_order, created_at DESC);

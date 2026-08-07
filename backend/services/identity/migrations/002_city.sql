-- user preferred city for discovery (Home/Search)
ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '';

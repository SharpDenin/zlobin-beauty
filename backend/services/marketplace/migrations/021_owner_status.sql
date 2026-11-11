-- Denormalized identity owner eligibility for public search.
-- Search filters on this column so deleted/blocked masters stay hidden when identity batch is down.
--
-- Compatibility / safety notes (Postgres 11+):
-- - ADD COLUMN … NOT NULL DEFAULT 'active' is metadata-only for a constant default;
--   existing rows receive 'active' without a full table rewrite.
-- - Re-running is safe: IF NOT EXISTS / DROP CONSTRAINT IF EXISTS / IF NOT EXISTS index.
-- - DEFAULT does not overwrite non-NULL owner_status on later applies.
-- - Rollback: do NOT DROP the column if blocked/deleted values exist. Instead keep the
--   column and temporarily remove the search predicate in application code, or restore
--   from backup taken before migration. Never mass-UPDATE owner_status='active'.

ALTER TABLE master_profiles
    ADD COLUMN IF NOT EXISTS owner_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE master_profiles
    DROP CONSTRAINT IF EXISTS master_profiles_owner_status_check;

ALTER TABLE master_profiles
    ADD CONSTRAINT master_profiles_owner_status_check
    CHECK (owner_status IN ('active', 'blocked', 'deleted'));

CREATE INDEX IF NOT EXISTS master_profiles_owner_status_published_idx
    ON master_profiles (owner_status, published)
    WHERE published = TRUE AND owner_status = 'active';

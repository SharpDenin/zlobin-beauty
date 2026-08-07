-- marketplace: richer master profile for publish checklist
ALTER TABLE master_profiles
    ADD COLUMN IF NOT EXISTS experience_years INT NOT NULL DEFAULT 0 CHECK (experience_years >= 0),
    ADD COLUMN IF NOT EXISTS education TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS service_categories (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Branch as salon location + B2B pickup point.

ALTER TABLE branches
    ADD COLUMN IF NOT EXISTS pickup_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE branches
    ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;

ALTER TABLE branches
    ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

ALTER TABLE branches
    ADD COLUMN IF NOT EXISTS working_hours_note TEXT NOT NULL DEFAULT '';

ALTER TABLE branches
    ADD COLUMN IF NOT EXISTS photo_media_id UUID;

CREATE INDEX IF NOT EXISTS branches_city_active_idx
    ON branches(city)
    WHERE published = true AND pickup_enabled = true;

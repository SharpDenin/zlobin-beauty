-- Flexible vs fixed-window services + service occurrences.

ALTER TABLE services
    ADD COLUMN IF NOT EXISTS booking_mode TEXT NOT NULL DEFAULT 'flexible';

ALTER TABLE services
    DROP CONSTRAINT IF EXISTS services_booking_mode_check;

ALTER TABLE services
    ADD CONSTRAINT services_booking_mode_check
    CHECK (booking_mode IN ('flexible', 'fixed_window'));

CREATE TABLE IF NOT EXISTS service_occurrences (
    id UUID PRIMARY KEY,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    master_user_id UUID NOT NULL,
    branch_id UUID,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
    capacity INT NOT NULL DEFAULT 1 CHECK (capacity > 0),
    booked_count INT NOT NULL DEFAULT 0 CHECK (booked_count >= 0),
    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'cancelled', 'completed', 'full')),
    booking_cutoff_at TIMESTAMPTZ,
    title TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at),
    CHECK (booked_count <= capacity)
);

CREATE INDEX IF NOT EXISTS service_occurrences_service_idx ON service_occurrences(service_id, starts_at);
CREATE INDEX IF NOT EXISTS service_occurrences_master_time_idx ON service_occurrences(master_user_id, starts_at);
CREATE INDEX IF NOT EXISTS service_occurrences_status_idx ON service_occurrences(status) WHERE status = 'scheduled';

-- Prevent overlapping active occurrences for the same master.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE service_occurrences DROP CONSTRAINT IF EXISTS service_occurrences_no_overlap;
ALTER TABLE service_occurrences ADD CONSTRAINT service_occurrences_no_overlap
EXCLUDE USING gist (
    master_user_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (status IN ('scheduled', 'full'));

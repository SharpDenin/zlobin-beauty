-- Location / timezone snapshots + fixed-window occurrence link.

ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS occurrence_id UUID;

ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS booking_mode TEXT NOT NULL DEFAULT 'flexible';

ALTER TABLE appointments
    DROP CONSTRAINT IF EXISTS appointments_booking_mode_check;

ALTER TABLE appointments
    ADD CONSTRAINT appointments_booking_mode_check
    CHECK (booking_mode IN ('flexible', 'fixed_window'));

ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS location_name TEXT NOT NULL DEFAULT '';

ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS location_city TEXT NOT NULL DEFAULT '';

ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS location_address TEXT NOT NULL DEFAULT '';

ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS location_timezone TEXT NOT NULL DEFAULT 'Europe/Moscow';

CREATE INDEX IF NOT EXISTS appointments_occurrence_idx ON appointments(occurrence_id)
    WHERE occurrence_id IS NOT NULL;

-- At most one active booking per occurrence when capacity is managed at occurrence level;
-- uniqueness of (occurrence_id) for active rows when capacity=1 is enforced in app + occurrence booked_count.
CREATE UNIQUE INDEX IF NOT EXISTS appointments_one_active_per_occurrence_idx
    ON appointments(occurrence_id)
    WHERE occurrence_id IS NOT NULL
      AND status IN ('pending_confirmation', 'confirmed', 'in_progress');

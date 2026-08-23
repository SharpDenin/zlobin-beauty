-- Allow multiple active bookings per occurrence when marketplace capacity > 1.
-- Capacity is enforced by marketplace booked_count CAS, not a unique index.

DROP INDEX IF EXISTS appointments_one_active_per_occurrence_idx;

-- Non-unique index retained for lookups (006 already creates appointments_occurrence_idx).
CREATE INDEX IF NOT EXISTS appointments_active_occurrence_idx
    ON appointments(occurrence_id)
    WHERE occurrence_id IS NOT NULL
      AND status IN ('pending_confirmation', 'confirmed', 'in_progress');

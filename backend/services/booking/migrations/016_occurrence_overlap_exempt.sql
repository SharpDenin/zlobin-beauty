-- Group fixed_window sessions (capacity > 1) intentionally share the same
-- starts_at/ends_at for every attendee. Capacity is enforced by marketplace
-- booked_count CAS; the master-day exclusion must not reject sibling seats.
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_no_overlap;
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
EXCLUDE USING gist (
    master_user_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (
    status IN ('pending_confirmation', 'confirmed', 'in_progress')
    AND occurrence_id IS NULL
);

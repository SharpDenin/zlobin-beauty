ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS visit_group_id UUID;

CREATE INDEX IF NOT EXISTS appointments_visit_group_idx
    ON appointments(visit_group_id)
    WHERE visit_group_id IS NOT NULL;

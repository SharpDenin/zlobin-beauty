ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS source_id UUID;

CREATE INDEX IF NOT EXISTS appointments_source_idx ON appointments(source, source_id)
    WHERE source <> '';

-- before/after photos attached to appointments
CREATE TABLE IF NOT EXISTS appointment_photos (
    id UUID PRIMARY KEY,
    appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    media_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('before', 'after')),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appointment_photos_appt_idx ON appointment_photos(appointment_id, kind, created_at);

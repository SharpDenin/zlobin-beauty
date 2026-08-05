-- Stage 2: appointment status history + cancel reason.
CREATE TABLE appointment_status_history (
  id UUID PRIMARY KEY,
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_user_id UUID NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX appointment_status_history_appt_idx ON appointment_status_history(appointment_id, created_at);

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancel_reason TEXT NOT NULL DEFAULT '';

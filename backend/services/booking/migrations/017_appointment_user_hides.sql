-- Soft-hide / archive for appointments (per viewer). Does not change status lifecycle.

CREATE TABLE IF NOT EXISTS appointment_user_hides (
    appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    hidden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (appointment_id, user_id)
);

CREATE INDEX IF NOT EXISTS appointment_user_hides_user_idx
    ON appointment_user_hides (user_id, hidden_at DESC);

-- Day-level exceptions: day off or custom hours for a concrete date.
CREATE TABLE IF NOT EXISTS schedule_exceptions (
    id UUID PRIMARY KEY,
    master_user_id UUID NOT NULL,
    day DATE NOT NULL,
    is_day_off BOOLEAN NOT NULL DEFAULT FALSE,
    start_minute INT,
    end_minute INT,
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (master_user_id, day),
    CHECK (
        (is_day_off = TRUE AND start_minute IS NULL AND end_minute IS NULL)
        OR (
            is_day_off = FALSE
            AND start_minute IS NOT NULL AND end_minute IS NOT NULL
            AND start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute
        )
    )
);

CREATE INDEX IF NOT EXISTS schedule_exceptions_master_day_idx
    ON schedule_exceptions(master_user_id, day);

CREATE TABLE IF NOT EXISTS client_model_preferences (
    user_id UUID PRIMARY KEY,
    willing BOOLEAN NOT NULL DEFAULT FALSE,
    notify BOOLEAN NOT NULL DEFAULT FALSE,
    categories TEXT[] NOT NULL DEFAULT '{}',
    city TEXT NOT NULL DEFAULT '',
    date_from DATE,
    date_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_model_preferences_match_idx
    ON client_model_preferences(willing, notify, city)
    WHERE willing AND notify;

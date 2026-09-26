-- Masterclass marketplace (separate from fixed_window service occurrences)
-- and model requests.

CREATE TABLE IF NOT EXISTS masterclass_events (
    id UUID PRIMARY KEY,
    instructor_user_id UUID NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    city TEXT NOT NULL,
    location_note TEXT NOT NULL DEFAULT '',
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Krasnoyarsk',
    capacity INT NOT NULL CHECK (capacity > 0),
    status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'closed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS masterclass_events_pub_idx
    ON masterclass_events(status, starts_at)
    WHERE status = 'published';
CREATE INDEX IF NOT EXISTS masterclass_events_instructor_idx
    ON masterclass_events(instructor_user_id, starts_at DESC);

CREATE TABLE IF NOT EXISTS masterclass_interests (
    id UUID PRIMARY KEY,
    master_user_id UUID NOT NULL,
    category TEXT NOT NULL,
    city TEXT NOT NULL,
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    location_note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (date_to >= date_from)
);

CREATE INDEX IF NOT EXISTS masterclass_interests_match_idx
    ON masterclass_interests(status, category, city, date_from, date_to);

CREATE TABLE IF NOT EXISTS masterclass_registrations (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES masterclass_events(id) ON DELETE CASCADE,
    master_user_id UUID NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('requested', 'confirmed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, master_user_id)
);

CREATE INDEX IF NOT EXISTS masterclass_registrations_event_idx
    ON masterclass_registrations(event_id, status);

CREATE TABLE IF NOT EXISTS model_requests (
    id UUID PRIMARY KEY,
    master_user_id UUID NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL,
    location_note TEXT NOT NULL DEFAULT '',
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Krasnoyarsk',
    capacity INT NOT NULL CHECK (capacity > 0),
    accepted_count INT NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
    status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'closed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at),
    CHECK (accepted_count <= capacity)
);

CREATE INDEX IF NOT EXISTS model_requests_pub_idx
    ON model_requests(status, starts_at)
    WHERE status = 'published';
CREATE INDEX IF NOT EXISTS model_requests_master_idx
    ON model_requests(master_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS model_responses (
    id UUID PRIMARY KEY,
    request_id UUID NOT NULL REFERENCES model_requests(id) ON DELETE CASCADE,
    client_user_id UUID NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('requested', 'accepted', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS model_responses_request_idx ON model_responses(request_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS model_responses_open_uidx
    ON model_responses(request_id, client_user_id)
    WHERE status IN ('requested', 'accepted');

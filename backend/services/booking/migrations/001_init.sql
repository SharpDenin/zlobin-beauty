-- booking schema
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE working_hours (
    id UUID PRIMARY KEY,
    master_user_id UUID NOT NULL,
    weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_minute INT NOT NULL CHECK (start_minute >= 0 AND start_minute < 1440),
    end_minute INT NOT NULL CHECK (end_minute > start_minute AND end_minute <= 1440),
    UNIQUE (master_user_id, weekday, start_minute, end_minute)
);

CREATE TABLE appointments (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    master_user_id UUID NOT NULL,
    client_user_id UUID NOT NULL,
    service_id UUID NOT NULL,
    service_name TEXT NOT NULL,
    duration_minutes INT NOT NULL,
    price_minor BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'RUB',
    status TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);

CREATE INDEX appointments_master_time_idx ON appointments(master_user_id, starts_at);
CREATE INDEX appointments_client_idx ON appointments(client_user_id);
CREATE INDEX appointments_org_idx ON appointments(organization_id);

-- Prevent overlapping active appointments for the same master.
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
EXCLUDE USING gist (
    master_user_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (status IN ('pending_confirmation', 'confirmed', 'in_progress'));

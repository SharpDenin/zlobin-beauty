-- Operational work modes, onsite geo, salon chairs, and chair leases.
-- Independent from marketplace work_type / profession types.

CREATE TABLE IF NOT EXISTS geo_cities (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    timezone TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS geo_districts (
    id UUID PRIMARY KEY,
    city_id UUID NOT NULL REFERENCES geo_cities(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE (city_id, name)
);

INSERT INTO geo_cities(id, name, timezone) VALUES
    ('11111111-1111-4111-8111-111111111001', 'Красноярск', 'Asia/Krasnoyarsk'),
    ('11111111-1111-4111-8111-111111111002', 'Новосибирск', 'Asia/Novosibirsk'),
    ('11111111-1111-4111-8111-111111111003', 'Москва', 'Europe/Moscow')
ON CONFLICT (id) DO NOTHING;

INSERT INTO geo_districts(id, city_id, name) VALUES
    ('11111111-1111-4111-8111-111111111011', '11111111-1111-4111-8111-111111111001', 'Центральный'),
    ('11111111-1111-4111-8111-111111111012', '11111111-1111-4111-8111-111111111001', 'Октябрьский'),
    ('11111111-1111-4111-8111-111111111013', '11111111-1111-4111-8111-111111111001', 'Железнодорожный'),
    ('11111111-1111-4111-8111-111111111014', '11111111-1111-4111-8111-111111111001', 'Советский'),
    ('11111111-1111-4111-8111-111111111015', '11111111-1111-4111-8111-111111111001', 'Свердловский'),
    ('11111111-1111-4111-8111-111111111016', '11111111-1111-4111-8111-111111111001', 'Ленинский'),
    ('11111111-1111-4111-8111-111111111017', '11111111-1111-4111-8111-111111111001', 'Кировский'),
    ('11111111-1111-4111-8111-111111111021', '11111111-1111-4111-8111-111111111002', 'Центральный'),
    ('11111111-1111-4111-8111-111111111022', '11111111-1111-4111-8111-111111111002', 'Ленинский'),
    ('11111111-1111-4111-8111-111111111031', '11111111-1111-4111-8111-111111111003', 'ЦАО'),
    ('11111111-1111-4111-8111-111111111032', '11111111-1111-4111-8111-111111111003', 'САО')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS salon_chairs (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    listed_for_rent BOOLEAN NOT NULL DEFAULT FALSE,
    rent_terms TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS salon_chairs_org_idx ON salon_chairs(organization_id, status);
CREATE INDEX IF NOT EXISTS salon_chairs_marketplace_idx ON salon_chairs(listed_for_rent) WHERE listed_for_rent AND status = 'active';

CREATE TABLE IF NOT EXISTS chair_leases (
    id UUID PRIMARY KEY,
    chair_id UUID NOT NULL REFERENCES salon_chairs(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL,
    renter_user_id UUID NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('requested', 'active', 'rejected', 'cancelled', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS chair_leases_chair_idx ON chair_leases(chair_id, status);
CREATE INDEX IF NOT EXISTS chair_leases_renter_idx ON chair_leases(renter_user_id, status);

ALTER TABLE chair_leases DROP CONSTRAINT IF EXISTS chair_leases_no_overlap;
ALTER TABLE chair_leases ADD CONSTRAINT chair_leases_no_overlap
EXCLUDE USING gist (
    chair_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (status = 'active');

CREATE TABLE IF NOT EXISTS master_work_mode_intervals (
    id UUID PRIMARY KEY,
    master_user_id UUID NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('percentage', 'chair', 'onsite')),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    timezone TEXT NOT NULL,
    organization_id UUID,
    branch_id UUID,
    chair_id UUID REFERENCES salon_chairs(id),
    percentage_rate NUMERIC(5,2),
    city_id UUID REFERENCES geo_cities(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS master_work_mode_intervals_master_idx
    ON master_work_mode_intervals(master_user_id, starts_at, ends_at);

ALTER TABLE master_work_mode_intervals DROP CONSTRAINT IF EXISTS master_work_mode_intervals_no_overlap;
ALTER TABLE master_work_mode_intervals ADD CONSTRAINT master_work_mode_intervals_no_overlap
EXCLUDE USING gist (
    master_user_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
);

ALTER TABLE master_work_mode_intervals DROP CONSTRAINT IF EXISTS salon_chairs_interval_no_overlap;
ALTER TABLE master_work_mode_intervals ADD CONSTRAINT salon_chairs_interval_no_overlap
EXCLUDE USING gist (
    chair_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (mode = 'chair' AND chair_id IS NOT NULL);

CREATE TABLE IF NOT EXISTS master_work_mode_interval_districts (
    interval_id UUID NOT NULL REFERENCES master_work_mode_intervals(id) ON DELETE CASCADE,
    district_id UUID NOT NULL REFERENCES geo_districts(id),
    PRIMARY KEY (interval_id, district_id)
);

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS work_mode TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS work_mode_interval_id UUID;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS chair_id UUID;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS onsite_city_id UUID;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS onsite_district_id UUID;

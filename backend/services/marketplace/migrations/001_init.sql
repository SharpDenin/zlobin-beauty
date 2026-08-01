-- marketplace schema
CREATE TABLE master_profiles (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE,
    organization_id UUID NOT NULL,
    branch_id UUID,
    display_name TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    specializations TEXT[] NOT NULL DEFAULT '{}',
    city TEXT NOT NULL,
    rating_avg NUMERIC(3,2) NOT NULL DEFAULT 0,
    rating_count INT NOT NULL DEFAULT 0,
    published BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX master_profiles_city_published_idx ON master_profiles(city, published);
CREATE INDEX master_profiles_org_idx ON master_profiles(organization_id);

CREATE TABLE services (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
    price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
    currency TEXT NOT NULL DEFAULT 'RUB',
    published BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX services_org_idx ON services(organization_id);

CREATE TABLE master_services (
    master_id UUID NOT NULL REFERENCES master_profiles(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    price_minor_override BIGINT,
    PRIMARY KEY (master_id, service_id)
);

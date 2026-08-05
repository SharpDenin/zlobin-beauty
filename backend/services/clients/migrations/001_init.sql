-- clients service
CREATE TABLE client_cards (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    user_id UUID NOT NULL,
    display_name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    preferences TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, user_id)
);

CREATE INDEX client_cards_user_idx ON client_cards(user_id);
CREATE INDEX client_cards_org_idx ON client_cards(organization_id);

CREATE TABLE visits (
    id UUID PRIMARY KEY,
    client_card_id UUID NOT NULL REFERENCES client_cards(id) ON DELETE CASCADE,
    appointment_id UUID NOT NULL UNIQUE,
    organization_id UUID NOT NULL,
    master_user_id UUID NOT NULL,
    service_name TEXT NOT NULL,
    price_minor BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'RUB',
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX visits_master_idx ON visits(master_user_id);
CREATE INDEX visits_card_idx ON visits(client_card_id, completed_at DESC);

CREATE TABLE visit_notes (
    id UUID PRIMARY KEY,
    visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    author_user_id UUID NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE color_formulas (
    id UUID PRIMARY KEY,
    client_card_id UUID NOT NULL REFERENCES client_cards(id) ON DELETE CASCADE,
    visit_id UUID REFERENCES visits(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    brand TEXT NOT NULL DEFAULT '',
    components JSONB NOT NULL DEFAULT '[]'::jsonb,
    oxidizer TEXT NOT NULL DEFAULT '',
    ratio TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE consents (
    id UUID PRIMARY KEY,
    client_card_id UUID NOT NULL REFERENCES client_cards(id) ON DELETE CASCADE,
    consent_type TEXT NOT NULL,
    granted BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_card_id, consent_type)
);

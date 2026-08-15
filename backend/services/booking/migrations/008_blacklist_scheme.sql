-- No-show blacklist, structured service schemes, planner blocks, audit.

CREATE TABLE master_client_blacklist (
    master_user_id UUID NOT NULL,
    client_user_id UUID NOT NULL,
    reason TEXT NOT NULL DEFAULT 'no_show_threshold',
    blocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    unblocked_at TIMESTAMPTZ,
    unblocked_by UUID,
    created_by UUID NOT NULL,
    PRIMARY KEY (master_user_id, client_user_id)
);

CREATE INDEX master_client_blacklist_client_idx ON master_client_blacklist(client_user_id);
CREATE INDEX master_client_blacklist_active_idx
    ON master_client_blacklist(master_user_id)
    WHERE unblocked_at IS NULL;

CREATE TABLE appointment_service_schemes (
    appointment_id UUID PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
    technique TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    category_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    skipped BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE appointment_scheme_components (
    id UUID PRIMARY KEY,
    appointment_id UUID NOT NULL REFERENCES appointment_service_schemes(appointment_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    brand TEXT NOT NULL DEFAULT '',
    qty TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT '',
    proportion TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX appointment_scheme_components_appt_idx ON appointment_scheme_components(appointment_id, sort_order);

CREATE TABLE planner_blocks (
    id UUID PRIMARY KEY,
    owner_user_id UUID NOT NULL,
    organization_id UUID,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'personal',
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
    color TEXT NOT NULL DEFAULT '#b45a6a',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);

CREATE INDEX planner_blocks_owner_time_idx ON planner_blocks(owner_user_id, starts_at);

CREATE TABLE booking_audit_events (
    id UUID PRIMARY KEY,
    actor_user_id UUID,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX booking_audit_events_entity_idx ON booking_audit_events(entity_type, entity_id, created_at DESC);

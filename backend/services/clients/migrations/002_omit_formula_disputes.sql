-- Color formula disclosure flag (not skip_service_scheme).
ALTER TABLE color_formulas
    ADD COLUMN IF NOT EXISTS omit_formula BOOLEAN NOT NULL DEFAULT FALSE;

-- Client card disputes: "Не соответствует действительности". Does not mutate source fields.
CREATE TABLE IF NOT EXISTS client_card_disputes (
    id UUID PRIMARY KEY,
    client_card_id UUID NOT NULL REFERENCES client_cards(id) ON DELETE CASCADE,
    reporter_user_id UUID NOT NULL,
    field_key TEXT NOT NULL,
    comment TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID,
    CONSTRAINT client_card_disputes_status_chk CHECK (status IN ('open', 'resolved', 'rejected')),
    CONSTRAINT client_card_disputes_field_chk CHECK (field_key IN (
        'hair_color', 'hair_condition', 'preferences', 'display_name', 'phone', 'email'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS client_card_disputes_open_uniq
    ON client_card_disputes (client_card_id, field_key)
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS client_card_disputes_card_idx
    ON client_card_disputes (client_card_id, created_at DESC);

CREATE TABLE IF NOT EXISTS client_card_dispute_events (
    id UUID PRIMARY KEY,
    dispute_id UUID NOT NULL REFERENCES client_card_disputes(id) ON DELETE CASCADE,
    actor_user_id UUID NOT NULL,
    action TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_card_dispute_events_dispute_idx
    ON client_card_dispute_events (dispute_id, created_at);

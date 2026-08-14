-- Per master↔client auto-confirmation preference (not a global client flag).
CREATE TABLE master_client_settings (
    master_user_id UUID NOT NULL,
    client_user_id UUID NOT NULL,
    auto_confirm BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (master_user_id, client_user_id)
);

CREATE INDEX master_client_settings_client_idx
    ON master_client_settings(client_user_id);

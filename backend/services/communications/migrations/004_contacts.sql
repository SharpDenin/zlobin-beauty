-- Address book contacts owned by a user.

CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY,
    owner_user_id UUID NOT NULL,
    contact_user_id UUID NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT contacts_owner_contact_unique UNIQUE (owner_user_id, contact_user_id),
    CONSTRAINT contacts_not_self CHECK (owner_user_id <> contact_user_id)
);

CREATE INDEX IF NOT EXISTS contacts_owner_idx ON contacts (owner_user_id);

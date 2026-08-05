-- communications: notifications + reviews
CREATE TABLE notifications (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT '',
    entity_id UUID,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);

CREATE TABLE reviews (
    id UUID PRIMARY KEY,
    appointment_id UUID NOT NULL UNIQUE,
    client_user_id UUID NOT NULL,
    master_user_id UUID NOT NULL,
    master_rating INT NOT NULL CHECK (master_rating BETWEEN 1 AND 5),
    result_rating INT NOT NULL CHECK (result_rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL DEFAULT '',
    publish_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    hidden BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reviews_master_idx ON reviews(master_user_id, created_at DESC);

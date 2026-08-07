CREATE TABLE media_objects (
    id UUID PRIMARY KEY,
    owner_user_id UUID NOT NULL,
    purpose TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    sha256 TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    bucket TEXT NOT NULL,
    original_name TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_media_objects_owner ON media_objects (owner_user_id);
CREATE INDEX idx_media_objects_purpose ON media_objects (purpose);

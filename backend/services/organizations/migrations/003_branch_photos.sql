-- branch photos for salon onboarding / public cards
CREATE TABLE IF NOT EXISTS branch_photos (
    id UUID PRIMARY KEY,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    media_id UUID NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS branch_photos_branch_idx ON branch_photos(branch_id, sort_order, created_at);

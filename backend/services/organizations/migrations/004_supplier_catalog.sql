ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS logo_media_id UUID,
    ADD COLUMN IF NOT EXISTS delivery_note TEXT NOT NULL DEFAULT '';

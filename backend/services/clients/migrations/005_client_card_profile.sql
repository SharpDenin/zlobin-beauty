-- CRM client card profile fields shared by master and client (single source of truth).
ALTER TABLE client_cards
    ADD COLUMN IF NOT EXISTS photo_media_id UUID,
    ADD COLUMN IF NOT EXISTS birth_date DATE,
    ADD COLUMN IF NOT EXISTS loyalty_status TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS skin_type TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS skin_features TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS skin_photo_media_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS general_notes TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS client_cards_photo_idx ON client_cards(photo_media_id) WHERE photo_media_id IS NOT NULL;

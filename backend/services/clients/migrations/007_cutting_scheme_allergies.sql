-- Cutting scheme media slot for hair consultations + client-filled allergies on passport.
-- Rollback:
--   ALTER TABLE hair_consultation_media DROP CONSTRAINT IF EXISTS hair_consultation_media_slot_check;
--   ALTER TABLE hair_consultation_media ADD CONSTRAINT hair_consultation_media_slot_check
--     CHECK (slot IN ('overview', 'roots', 'length', 'ends', 'strand_a4', 'reference'));
--   ALTER TABLE client_cards DROP COLUMN IF EXISTS allergies;

ALTER TABLE hair_consultation_media
  DROP CONSTRAINT IF EXISTS hair_consultation_media_slot_check;

ALTER TABLE hair_consultation_media
  ADD CONSTRAINT hair_consultation_media_slot_check
  CHECK (slot IN ('overview', 'roots', 'length', 'ends', 'strand_a4', 'reference', 'cutting_scheme'));

ALTER TABLE client_cards
  ADD COLUMN IF NOT EXISTS allergies TEXT NOT NULL DEFAULT '';

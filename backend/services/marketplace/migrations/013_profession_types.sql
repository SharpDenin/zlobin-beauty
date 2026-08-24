-- Professional types (marketplace catalog). This is NOT work_type and NOT an operational booking mode.
-- Table names follow the Phase 1 spec: master_types + master_profile_types.

CREATE TABLE IF NOT EXISTS master_types (
    id UUID PRIMARY KEY,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT master_types_slug_key UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS master_types_active_name_idx
    ON master_types (is_active, name);

CREATE TABLE IF NOT EXISTS master_profile_types (
    id UUID PRIMARY KEY,
    master_user_id UUID NOT NULL REFERENCES master_profiles(user_id) ON DELETE CASCADE,
    profession_type_id UUID NOT NULL REFERENCES master_types(id),
    locked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT master_profile_types_unique UNIQUE (master_user_id, profession_type_id)
);

CREATE INDEX IF NOT EXISTS master_profile_types_master_user_idx
    ON master_profile_types (master_user_id);

CREATE INDEX IF NOT EXISTS master_profile_types_profession_type_idx
    ON master_profile_types (profession_type_id);

-- Catalog seed (fixed UUIDs for demo/tests). Extensible: new rows can be inserted later.
INSERT INTO master_types (id, slug, name, is_active)
VALUES
    ('11111111-1111-4111-8111-111111111001', 'colorist', 'Колорист', TRUE),
    ('11111111-1111-4111-8111-111111111002', 'hairdresser', 'Парикмахер', TRUE),
    ('11111111-1111-4111-8111-111111111003', 'barber', 'Барбер', TRUE),
    ('11111111-1111-4111-8111-111111111004', 'nail_master', 'Мастер маникюра', TRUE),
    ('11111111-1111-4111-8111-111111111005', 'pedicure_master', 'Мастер педикюра', TRUE)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    is_active = TRUE,
    updated_at = now();

-- Safe specialization → profession type backfill. specializations column is NOT dropped.
-- Mapping decision:
--   колористика / колорист / окрашивание → colorist
--   стрижки / стрижка / парикмахер / укладки / укладка / уход → hairdresser
--   барбер / борода → barber
--   маникюр / ногти → nail_master
--   педикюр → pedicure_master
-- Unmapped tags (брови, ресницы, …) are kept on specializations.
-- Published masters with zero mapped types get fallback hairdresser.
-- Fallback is backfill-only and MUST NOT be used for new registrations.

INSERT INTO master_profile_types (id, master_user_id, profession_type_id, locked_at)
SELECT md5(mp.user_id::text || mapped.type_id::text)::uuid, mp.user_id, mapped.type_id,
       CASE WHEN mp.published THEN now() ELSE NULL END
FROM master_profiles mp
JOIN LATERAL (
    SELECT DISTINCT mt.id AS type_id
    FROM unnest(mp.specializations) AS spec(value)
    JOIN master_types mt ON mt.slug = CASE
        WHEN lower(spec.value) IN ('колористика', 'колорист', 'окрашивание') THEN 'colorist'
        WHEN lower(spec.value) IN ('стрижки', 'стрижка', 'парикмахер', 'укладки', 'укладка', 'уход') THEN 'hairdresser'
        WHEN lower(spec.value) IN ('барбер', 'борода') THEN 'barber'
        WHEN lower(spec.value) IN ('маникюр', 'ногти') THEN 'nail_master'
        WHEN lower(spec.value) IN ('педикюр') THEN 'pedicure_master'
        ELSE NULL
    END
) mapped ON TRUE
ON CONFLICT (master_user_id, profession_type_id) DO NOTHING;

-- Documented published-master fallback: hairdresser, only when no mapped type exists.
INSERT INTO master_profile_types (id, master_user_id, profession_type_id, locked_at)
SELECT md5(mp.user_id::text || 'hairdresser-fallback')::uuid,
       mp.user_id,
       '11111111-1111-4111-8111-111111111002',
       now()
FROM master_profiles mp
WHERE mp.published = TRUE
  AND NOT EXISTS (
      SELECT 1 FROM master_profile_types mpt WHERE mpt.master_user_id = mp.user_id
  )
ON CONFLICT (master_user_id, profession_type_id) DO NOTHING;

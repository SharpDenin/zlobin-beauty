-- Independent / private / mobile masters may work without a salon organization.
ALTER TABLE master_profiles
    ALTER COLUMN organization_id DROP NOT NULL;

-- Additional profession types used across registration, profile, search and filters.
INSERT INTO master_types (id, slug, name, is_active)
VALUES
    ('11111111-1111-4111-8111-111111111006', 'brow_lash', 'Брови и ресницы', TRUE),
    ('11111111-1111-4111-8111-111111111007', 'cosmetologist', 'Косметолог', TRUE)
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    is_active = TRUE,
    updated_at = now();

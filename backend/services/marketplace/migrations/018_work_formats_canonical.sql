-- ROLE-01: expand allowed work_type codes with four canonical formats.
-- Do NOT drop legacy values; do NOT rewrite rows in this migration.

ALTER TABLE master_profiles
    DROP CONSTRAINT IF EXISTS master_profiles_work_type_check;

ALTER TABLE master_profiles
    ADD CONSTRAINT master_profiles_work_type_check
    CHECK (work_type IN (
        -- Canonical (ROLE-01)
        'private_practice',
        'percentage_based',
        'mobile_service',
        'chair_rental',
        -- Legacy formats / aliases still present in older clients and data
        'employee',
        'renter',
        'chair_master',
        'independent',
        'private_master',
        'mobile_master',
        -- Ownership codes historically stored as work_type (not formats)
        'owner',
        'salon_owner',
        'chain_owner'
    ));

ALTER TABLE master_profiles
    ALTER COLUMN work_type SET DEFAULT 'private_practice';

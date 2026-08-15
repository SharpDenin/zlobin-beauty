-- Expand master work_type without dropping existing values.

ALTER TABLE master_profiles
    DROP CONSTRAINT IF EXISTS master_profiles_work_type_check;

ALTER TABLE master_profiles
    ADD CONSTRAINT master_profiles_work_type_check
    CHECK (work_type IN (
        'employee',
        'renter',
        'chair_master',
        'owner',
        'salon_owner',
        'chain_owner',
        'independent',
        'private_master',
        'mobile_master'
    ));

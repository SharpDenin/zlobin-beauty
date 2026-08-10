-- Master operating format (work type) for onboarding / permissions framing.
ALTER TABLE master_profiles
    ADD COLUMN IF NOT EXISTS work_type TEXT NOT NULL DEFAULT 'independent'
        CHECK (work_type IN ('employee', 'renter', 'owner', 'salon_owner', 'independent'));

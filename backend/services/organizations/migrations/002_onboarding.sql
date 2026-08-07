-- organizations: publication + description for salon onboarding
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE branches
    ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT FALSE;

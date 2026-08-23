-- Phase 2: representative display identity + task kinds for planner.

ALTER TABLE supplier_representatives
    ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';

ALTER TABLE representative_tasks
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'other',
    ADD COLUMN IF NOT EXISTS expected_result TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'representative_tasks_kind_check'
    ) THEN
        ALTER TABLE representative_tasks
            ADD CONSTRAINT representative_tasks_kind_check
            CHECK (kind IN ('salon_visit', 'delivery_support', 'payment_collection', 'commercial_visit', 'other'));
    END IF;
END $$;

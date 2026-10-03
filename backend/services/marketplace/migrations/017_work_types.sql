-- Multi-select work formats. Primary work_type stays for legacy / org-need logic.
ALTER TABLE master_profiles
    ADD COLUMN IF NOT EXISTS work_types text[] NOT NULL DEFAULT '{}';

UPDATE master_profiles
SET work_types = ARRAY[work_type]
WHERE (work_types IS NULL OR cardinality(work_types) = 0)
  AND work_type IS NOT NULL
  AND work_type <> '';

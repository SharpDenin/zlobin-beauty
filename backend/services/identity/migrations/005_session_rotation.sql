-- Rotation bookkeeping so a benign parallel refresh (two tabs, retry) is not treated as token theft.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS replaced_by UUID;

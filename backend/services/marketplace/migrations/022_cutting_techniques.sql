-- Optional cutting techniques on master profiles (not a publish gate).
ALTER TABLE master_profiles
  ADD COLUMN IF NOT EXISTS cutting_techniques TEXT[] NOT NULL DEFAULT '{}';

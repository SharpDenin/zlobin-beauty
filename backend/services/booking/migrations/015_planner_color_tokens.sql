-- Planner block colors: prefer design-token ids; keep legacy hex values as-is.
ALTER TABLE planner_blocks ALTER COLUMN color SET DEFAULT 'primary';

UPDATE planner_blocks
SET color = 'primary'
WHERE color IS NULL OR btrim(color) = '' OR lower(btrim(color)) IN ('#b45a6a', '#b45a6aff');

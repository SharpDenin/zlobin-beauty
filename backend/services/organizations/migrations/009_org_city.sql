-- ORG-02: organization may exist without branches; store city/address on the org itself.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address_line TEXT NOT NULL DEFAULT '';

-- Best-effort backfill from the first branch so existing rows keep a useful city.
UPDATE organizations o
SET city = COALESCE(NULLIF(b.city, ''), o.city),
    address_line = COALESCE(NULLIF(b.address_line, ''), o.address_line)
FROM (
  SELECT DISTINCT ON (organization_id) organization_id, city, address_line
  FROM branches
  ORDER BY organization_id, name
) b
WHERE b.organization_id = o.id
  AND (o.city = '' OR o.address_line = '');

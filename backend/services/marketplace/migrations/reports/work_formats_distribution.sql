-- ROLE-01 read-only audit for staging/production.
-- Does NOT modify data. Run manually and keep results for the data-migration plan.
-- Usage: psql "$DATABASE_URL" -f work_formats_distribution.sql

\echo '=== Distribution by work_type (legacy primary) ==='
SELECT work_type, COUNT(*) AS n
FROM master_profiles
GROUP BY work_type
ORDER BY n DESC, work_type;

\echo '=== Distribution by unnest(work_types) ==='
SELECT COALESCE(wt, '(null)') AS work_types_elem, COUNT(*) AS n
FROM master_profiles
LEFT JOIN LATERAL unnest(work_types) AS wt ON true
GROUP BY wt
ORDER BY n DESC, work_types_elem;

\echo '=== Legacy alias / format counts (work_type column) ==='
SELECT work_type, COUNT(*) AS n
FROM master_profiles
WHERE work_type IN (
  'independent', 'private_master', 'mobile_master', 'renter', 'chair_master',
  'employee', 'owner', 'salon_owner', 'chain_owner'
)
GROUP BY work_type
ORDER BY n DESC;

\echo '=== employee count (work_type and work_types) ==='
SELECT
  COUNT(*) FILTER (WHERE work_type = 'employee') AS work_type_employee,
  COUNT(*) FILTER (WHERE 'employee' = ANY (work_types)) AS work_types_contains_employee
FROM master_profiles;

\echo '=== ownership codes count ==='
SELECT
  COUNT(*) FILTER (WHERE work_type IN ('owner', 'salon_owner', 'chain_owner')) AS work_type_ownership,
  COUNT(*) FILTER (
    WHERE work_types && ARRAY['owner', 'salon_owner', 'chain_owner']::text[]
  ) AS work_types_contains_ownership
FROM master_profiles;

\echo '=== Mismatch: work_type not in work_types (or work_types empty while work_type set) ==='
SELECT id, user_id, work_type, work_types
FROM master_profiles
WHERE work_type IS NOT NULL
  AND work_type <> ''
  AND (
    work_types IS NULL
    OR cardinality(work_types) = 0
    OR NOT (work_type = ANY (work_types))
  )
ORDER BY updated_at DESC NULLS LAST
LIMIT 200;

\echo '=== Canonical vs legacy summary ==='
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE work_type IN ('private_practice', 'percentage_based', 'mobile_service', 'chair_rental')) AS canonical_primary,
  COUNT(*) FILTER (WHERE work_type IN ('independent', 'private_master', 'mobile_master', 'renter', 'chair_master')) AS legacy_alias_primary,
  COUNT(*) FILTER (WHERE work_type = 'employee') AS employee_primary,
  COUNT(*) FILTER (WHERE work_type IN ('owner', 'salon_owner', 'chain_owner')) AS ownership_primary
FROM master_profiles;

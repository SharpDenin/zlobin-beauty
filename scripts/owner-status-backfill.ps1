# Dry-run / apply owner_status backfill against local or host-bound Postgres.
# Does NOT default to --apply. Production apply requires explicit -Apply and operator confirmation.
param(
  [switch]$Apply,
  [string]$Report = "",
  [string]$ResumeAfter = "",
  [int]$BatchSize = 200
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"

if (-not $env:MARKETPLACE_DATABASE_URL) {
  $env:MARKETPLACE_DATABASE_URL = "postgres://marketplace:marketplace@127.0.0.1:5433/marketplace?sslmode=disable"
}
if (-not $env:IDENTITY_DATABASE_URL) {
  $env:IDENTITY_DATABASE_URL = "postgres://identity:identity@127.0.0.1:5433/identity?sslmode=disable"
}

$goArgs = @("run", "./cmd/owner-status-backfill", "-batch-size=$BatchSize")
if ($Report) { $goArgs += "-report=$Report" }
if ($ResumeAfter) { $goArgs += "-resume-after=$ResumeAfter" }
if ($Apply) {
  Write-Host "WARNING: --apply will write marketplace.master_profiles.owner_status" -ForegroundColor Yellow
  $goArgs += "-apply"
} else {
  Write-Host "Dry-run only (pass -Apply to write)" -ForegroundColor Cyan
}

Push-Location $backend
try {
  & go @goArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

# Run Go / Vitest / Playwright entirely inside Docker against the local compose stack.
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-docker.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\test-docker.ps1 -Rebuild
#
# Does not delete volumes or wipe databases. Does not use hybrid Windows Go services.

param(
  [switch]$Rebuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $root ".env.example") $envFile
}

New-Item -ItemType Directory -Force -Path (Join-Path $root "test-results\go") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root "test-results\vitest") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root "test-results\playwright") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root "test-results\playwright-report") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root "test-results\playwright-meta") | Out-Null

Write-Host "==> Ensuring Docker app stack is up (no volume wipe)..."
if ($Rebuild) {
  docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml up -d --build `
    postgres nats minio identity organizations marketplace booking clients commerce communications media gateway frontend
} else {
  docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml up -d `
    postgres nats minio identity organizations marketplace booking clients commerce communications media gateway frontend
}
if ($LASTEXITCODE -ne 0) { throw "failed to start app stack (exit $LASTEXITCODE)" }

Write-Host "==> Waiting for gateway healthz..."
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:8090/healthz" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch {
    Start-Sleep -Seconds 3
  }
}
if (-not $ok) { throw "gateway not healthy" }

try {
  $fe = Invoke-WebRequest -Uri "http://127.0.0.1:5173/" -UseBasicParsing -TimeoutSec 5
  if ($fe.StatusCode -ne 200) { throw "frontend HTTP $($fe.StatusCode)" }
} catch {
  throw "frontend not reachable on :5173 — $($_.Exception.Message)"
}

Write-Host "==> Stabilizing 15s before tests..."
Start-Sleep -Seconds 15

$failed = 0

Write-Host "==> Go tests (container: test-go)..."
docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml --profile test run --rm test-go
if ($LASTEXITCODE -ne 0) {
  Write-Host "Go tests FAILED (exit $LASTEXITCODE)"
  $failed = 1
} else {
  Write-Host "Go tests OK"
}

Write-Host "==> Vitest (container: test-vitest)..."
docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml --profile test run --rm test-vitest
if ($LASTEXITCODE -ne 0) {
  Write-Host "Vitest FAILED (exit $LASTEXITCODE)"
  $failed = 1
} else {
  Write-Host "Vitest OK"
}

Write-Host "==> Playwright E2E (container: test-playwright)..."
docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml --profile test run --rm test-playwright
if ($LASTEXITCODE -ne 0) {
  Write-Host "Playwright FAILED (exit $LASTEXITCODE)"
  $failed = 1
} else {
  Write-Host "Playwright OK"
}

$latencyFile = Join-Path $root "test-results\playwright-meta\latency.jsonl"
if (Test-Path $latencyFile) {
  Write-Host "==> Delivery latency samples:"
  Get-Content $latencyFile | ForEach-Object { Write-Host $_ }
} else {
  Write-Host "==> No latency.jsonl produced (see test-results/playwright-meta/playwright.log)"
}

Write-Host "==> Reports:"
Write-Host "  test-results/go/"
Write-Host "  test-results/vitest/"
Write-Host "  test-results/playwright/ (+ playwright-report/, playwright-meta/)"

if ($failed -ne 0) {
  Write-Host "ONE OR MORE TEST STAGES FAILED"
  exit 1
}
Write-Host "ALL DOCKER TEST STAGES PASSED"
exit 0

# Full local stack in Docker only (no hybrid Windows Go processes).
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\dev-docker.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $root ".env.example") $envFile
}

Write-Host "Building and starting full Docker stack (compose + compose.dev)..."
Write-Host "Backend images use backend/Dockerfile.dev (Debian). Production Dockerfile stays Alpine."
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }

Write-Host "Waiting for gateway healthz..."
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:8090/healthz" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch {
    Start-Sleep -Seconds 3
  }
}
if (-not $ok) { throw "gateway not healthy on http://127.0.0.1:8090/healthz" }

Write-Host "Gateway OK. Frontend: http://127.0.0.1:5173  API: http://127.0.0.1:8090"
Write-Host "Optional seed: docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile seed run --rm -e ALLOW_SEED=true seed"

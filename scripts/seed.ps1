$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$gateway = if ($env:GATEWAY_URL) { $env:GATEWAY_URL } else { "http://localhost:8090" }
$password = if ($env:SEED_PASSWORD) { $env:SEED_PASSWORD } else { "Password123!" }

Write-Host "Waiting for gateway health at $gateway/healthz ..."
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $resp = Invoke-WebRequest -Uri "$gateway/healthz" -UseBasicParsing -TimeoutSec 3
    if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
      $ready = $true
      break
    }
  } catch {
    # retry
  }
  Start-Sleep -Seconds 2
}
if (-not $ready) { throw "gateway not healthy at $gateway" }

if ($args -contains "-Local" -or $args -contains "--local") {
  Write-Host "Running seed via go run ./cmd/seed"
  Push-Location (Join-Path $root "backend")
  try {
    $env:GATEWAY_URL = $gateway
    $env:SEED_PASSWORD = $password
    go run ./cmd/seed
  } finally {
    Pop-Location
  }
} else {
  Write-Host "Running seed via docker compose --profile seed"
  $env:SEED_PASSWORD = $password
  docker compose --profile seed run --rm seed
}

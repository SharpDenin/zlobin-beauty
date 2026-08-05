$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $root ".env.example") $envFile }

New-Item -ItemType Directory -Force -Path (Join-Path $root ".logs") | Out-Null

docker compose up -d postgres nats

Write-Host "Waiting for postgres..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  docker compose exec -T postgres pg_isready -U postgres | Out-Null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) { throw "postgres not ready" }

docker compose exec -T postgres psql -U postgres -d identity -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;" | Out-Null
docker compose exec -T postgres psql -U postgres -d booking -c "CREATE EXTENSION IF NOT EXISTS btree_gist;" | Out-Null

# Ensure Stage 2 databases exist on reused volumes
docker compose exec -T postgres psql -U postgres -d postgres -c @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clients') THEN
    CREATE USER clients WITH PASSWORD 'clients';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'clients') THEN
    CREATE DATABASE clients OWNER clients;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'communications') THEN
    CREATE USER communications WITH PASSWORD 'communications';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'communications') THEN
    CREATE DATABASE communications OWNER communications;
  END IF;
END
`$`$;
"@ | Out-Null

$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
$jwt = "dev-change-me-in-production-32chars"
$cors = "http://localhost:5173,http://127.0.0.1:5173"
$internal = "dev-internal-token"

function Start-GoSvc($name, $pkg, $port, $db, $extra = @{}) {
  $env:HTTP_ADDR = ":$port"
  $env:DATABASE_URL = $db
  $env:JWT_SECRET = $jwt
  $env:CORS_ORIGINS = $cors
  $env:LOG_LEVEL = "info"
  $env:INTERNAL_TOKEN = $internal
  $env:MIGRATIONS_DIR = Join-Path $root "backend\services\$name\migrations"
  foreach ($k in $extra.Keys) { Set-Item -Path "Env:$k" -Value $extra[$k] }
  Start-Process -FilePath "go" -ArgumentList @("run", $pkg) -WorkingDirectory (Join-Path $root "backend") `
    -RedirectStandardOutput (Join-Path $root ".logs\$name.out.log") `
    -RedirectStandardError (Join-Path $root ".logs\$name.err.log") | Out-Null
  Write-Host "started $name on $port"
}

Start-GoSvc "identity" "./services/identity/cmd/identity" 8101 "postgres://identity:identity@localhost:5433/identity?sslmode=disable"
Start-GoSvc "organizations" "./services/organizations/cmd/organizations" 8102 "postgres://organizations:organizations@localhost:5433/organizations?sslmode=disable"
Start-GoSvc "marketplace" "./services/marketplace/cmd/marketplace" 8103 "postgres://marketplace:marketplace@localhost:5433/marketplace?sslmode=disable" @{
  ORGANIZATIONS_URL = "http://127.0.0.1:8102"
}
Start-GoSvc "booking" "./services/booking/cmd/booking" 8104 "postgres://booking:booking@localhost:5433/booking?sslmode=disable" @{
  MARKETPLACE_URL = "http://127.0.0.1:8103"
  ORGANIZATIONS_URL = "http://127.0.0.1:8102"
  CLIENTS_URL = "http://127.0.0.1:8105"
  COMMUNICATIONS_URL = "http://127.0.0.1:8106"
}
Start-GoSvc "clients" "./services/clients/cmd/clients" 8105 "postgres://clients:clients@localhost:5433/clients?sslmode=disable"
Start-GoSvc "communications" "./services/communications/cmd/communications" 8106 "postgres://communications:communications@localhost:5433/communications?sslmode=disable" @{
  BOOKING_URL = "http://127.0.0.1:8104"
}

Start-Sleep -Seconds 2
$env:HTTP_ADDR = ":8090"
$env:JWT_SECRET = $jwt
$env:CORS_ORIGINS = $cors
$env:IDENTITY_URL = "http://127.0.0.1:8101"
$env:ORGANIZATIONS_URL = "http://127.0.0.1:8102"
$env:MARKETPLACE_URL = "http://127.0.0.1:8103"
$env:BOOKING_URL = "http://127.0.0.1:8104"
$env:CLIENTS_URL = "http://127.0.0.1:8105"
$env:COMMUNICATIONS_URL = "http://127.0.0.1:8106"
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:MIGRATIONS_DIR -ErrorAction SilentlyContinue
Start-Process -FilePath "go" -ArgumentList @("run", "./gateway/cmd/gateway") -WorkingDirectory (Join-Path $root "backend") `
  -RedirectStandardOutput (Join-Path $root ".logs\gateway.out.log") `
  -RedirectStandardError (Join-Path $root ".logs\gateway.err.log") | Out-Null

Write-Host "Gateway will listen on http://localhost:8090 (first go run may take ~1 min)"
Write-Host "Frontend: set VITE_API_BASE_URL=http://localhost:8090"

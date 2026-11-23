# Isolated owner-phone fallback check on local/dev (no seed reliance).
$ErrorActionPreference = 'Stop'
$api = 'http://localhost:8090'
$pass = 'Password123!'

function Login([string]$email) {
  $login = Invoke-RestMethod -Uri "$api/v1/auth/login" -Method POST -ContentType 'application/json' -Body (@{ email = $email; password = $pass } | ConvertTo-Json)
  return [string]$login.access_token
}
function AuthHdr([string]$token) {
  @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }
}

Push-Location $PSScriptRoot\..

$tok = Login 'master4@demo.local'
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$body = @{
  name = "G4 OwnerContact $ts"
  city = 'Красноярск'
  address_line = 'ул. Тест 99'
  type = 'salon'
  timezone = 'Asia/Krasnoyarsk'
  branch_name = "G4 OwnerContact HQ $ts"
  branch_city = 'Красноярск'
  branch_address_line = 'ул. Тест 99'
} | ConvertTo-Json
$created = Invoke-RestMethod -Uri "$api/v1/organizations" -Headers (AuthHdr $tok) -Method POST -Body ([Text.Encoding]::UTF8.GetBytes($body))
$orgId = [string]$created.organization.id
$branchId = [string]$created.branch.id

# Branch has a phone; owner will also have a phone; admin (if any) must be empty.
$null = Invoke-RestMethod -Uri "$api/v1/branches/$branchId" -Headers (AuthHdr $tok) -Method PATCH -Body (@{ phone = '+79005550000' } | ConvertTo-Json)

# Ensure owner phone is set and admin1 phone is empty (admin not in this org).
docker compose exec -T postgres psql -U identity -d identity -v ON_ERROR_STOP=1 -c @"
UPDATE users SET phone='+79006667788' WHERE email='master4@demo.local';
UPDATE users SET phone='' WHERE email='admin1@demo.local';
"@ | Out-Null

# Invite/add admin without phone into this org if API allows; otherwise membership walk has only owner.
# Prefer staff invite as admin:
try {
  $adminLogin = Login 'admin1@demo.local'
  # Resolve admin user id
  $adminId = (docker compose exec -T postgres psql -U identity -d identity -t -A -c "SELECT id::text FROM users WHERE email='admin1@demo.local';").Trim()
  $ownerId = (docker compose exec -T postgres psql -U identity -d identity -t -A -c "SELECT id::text FROM users WHERE email='master4@demo.local';").Trim()
  docker compose exec -T postgres psql -U organizations -d organizations -v ON_ERROR_STOP=1 -c @"
INSERT INTO memberships(id, organization_id, user_id, role, status, created_at)
VALUES ('$([guid]::NewGuid())', '$orgId', '$adminId', 'admin', 'active', now())
ON CONFLICT (organization_id, user_id, role) DO NOTHING;
"@ | Out-Null
} catch {
  Write-Host "admin membership setup note: $($_.Exception.Message)"
}

$pf = Invoke-RestMethod -Uri "$api/v1/branches/$branchId/close/preflight" -Headers (AuthHdr $tok)
Write-Host ("contact_source={0} contact_phone={1}" -f $pf.contact_source, $pf.contact_phone)

# Restore owner phone (unique empty-string constraint — use NULL).
docker compose exec -T postgres psql -U identity -d identity -c "UPDATE users SET phone=NULL WHERE email='master4@demo.local';" | Out-Null

if ($pf.contact_source -ne 'owner' -or $pf.contact_phone -ne '+79006667788') {
  Write-Error "FAIL: expected owner/+79006667788, got $($pf.contact_source)/$($pf.contact_phone)"
  exit 1
}
Write-Host 'PASS: owner phone preferred over branch when admin has no phone'
Pop-Location
exit 0

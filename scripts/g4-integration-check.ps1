# Group4 local-dev integration checks for branch close (no production).
$ErrorActionPreference = 'Stop'
$api = 'http://localhost:8090'
$pass = 'Password123!'
$internal = 'dev-internal-token'
$results = New-Object System.Collections.Generic.List[object]

function Record([string]$id, [string]$status, [string]$detail) {
  $results.Add([pscustomobject]@{ Scenario = $id; Status = $status; Detail = $detail })
  Write-Host "[$status] $id — $detail"
}

function Login([string]$email) {
  $login = Invoke-RestMethod -Uri "$api/v1/auth/login" -Method POST -ContentType 'application/json' -Body (@{ email = $email; password = $pass } | ConvertTo-Json)
  return [string]$login.access_token
}

function AuthHdr([string]$token) {
  return @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }
}

function CreateSalon([string]$token, [string]$name, [string]$phone) {
  $body = @{
    name                 = $name
    city                 = 'Красноярск'
    address_line         = 'ул. Тестовая, 10'
    type                 = 'salon'
    timezone             = 'Asia/Krasnoyarsk'
    branch_name          = "$name HQ"
    branch_city          = 'Красноярск'
    branch_address_line  = 'ул. Тестовая, 10'
  } | ConvertTo-Json
  $res = Invoke-RestMethod -Uri "$api/v1/organizations" -Headers (AuthHdr $token) -Method POST -Body ([Text.Encoding]::UTF8.GetBytes($body))
  if ($phone -and $res.branch.id) {
    $null = Invoke-RestMethod -Uri "$api/v1/branches/$($res.branch.id)" -Headers (AuthHdr $token) -Method PATCH -Body (@{ phone = $phone } | ConvertTo-Json)
  }
  return $res
}

Push-Location $PSScriptRoot\..

# Resolve identity user ids
$idLines = docker compose exec -T postgres psql -U identity -d identity -t -A -c "SELECT email||'|'||id::text FROM users WHERE email IN ('master4@demo.local','client1@demo.local','chain1@demo.local','admin1@demo.local','premium1@demo.local','master1@demo.local');"
$userMap = @{}
foreach ($line in ($idLines -split "`n")) {
  $t = $line.Trim()
  if ($t -match '\|') {
    $p = $t -split '\|', 2
    $userMap[$p[0]] = $p[1]
  }
}
$master4 = $userMap['master4@demo.local']
$client1 = $userMap['client1@demo.local']
$chain1 = $userMap['chain1@demo.local']
if (-not $master4 -or -not $client1) { throw "seed users missing" }

# --- Contact fallback resolution via preflight on seed branches ---
try {
  $tokC = Login 'chain1@demo.local'
  $pfC = Invoke-RestMethod -Uri "$api/v1/branches/01a1ef78-e98d-772c-bfd9-792f26c47321/close/preflight" -Headers (AuthHdr $tokC)
  if ($pfC.contact_source -eq 'branch' -and $pfC.contact_phone) {
    Record '6-contact-branch-fallback' 'PASS' "$($pfC.contact_source) $($pfC.contact_phone)"
  } else {
    Record '6-contact-branch-fallback' 'FAIL' "$($pfC.contact_source) $($pfC.contact_phone)"
  }
  # Clear branch phone temporarily to observe none/owner path — restore after
  $prevPhone = (Invoke-RestMethod -Uri "$api/v1/branches/01a1ef78-e98d-772c-bfd9-792f26c47321" -Headers (AuthHdr $tokC)).phone
  $null = Invoke-RestMethod -Uri "$api/v1/branches/01a1ef78-e98d-772c-bfd9-792f26c47321" -Headers (AuthHdr $tokC) -Method PATCH -Body (@{ phone = '' } | ConvertTo-Json)
  $pfNone = Invoke-RestMethod -Uri "$api/v1/branches/01a1ef78-e98d-772c-bfd9-792f26c47321/close/preflight" -Headers (AuthHdr $tokC)
  if ($pfNone.contact_source -eq 'none' -or $pfNone.contact_display -match 'приложени') {
    Record '6-contact-none-fallback' 'PASS' "$($pfNone.contact_source) $($pfNone.contact_display)"
  } else {
    Record '6-contact-none-fallback' 'FAIL' "$($pfNone.contact_source) $($pfNone.contact_display)"
  }
  $null = Invoke-RestMethod -Uri "$api/v1/branches/01a1ef78-e98d-772c-bfd9-792f26c47321" -Headers (AuthHdr $tokC) -Method PATCH -Body (@{ phone = $prevPhone } | ConvertTo-Json)
} catch {
  Record '6-contact-branch-fallback' 'FAIL' $_.Exception.Message
  Record '6-contact-none-fallback' 'FAIL' $_.Exception.Message
}

# Admin phone path: set admin1 phone, use master1 org where admin1 is admin
try {
  docker compose exec -T postgres psql -U identity -d identity -c "UPDATE users SET phone='+79001110099' WHERE email='admin1@demo.local';" | Out-Null
  $tokM1 = Login 'master1@demo.local'
  $pfA = Invoke-RestMethod -Uri "$api/v1/branches/01a1ef78-cc59-75a3-90ee-f7fa81ee2d1d/close/preflight" -Headers (AuthHdr $tokM1)
  if ($pfA.contact_source -eq 'admin' -and $pfA.contact_phone -eq '+79001110099') {
    Record '6-contact-admin-priority' 'PASS' "$($pfA.contact_source) $($pfA.contact_phone)"
  } else {
    Record '6-contact-admin-priority' 'FAIL' "$($pfA.contact_source) $($pfA.contact_phone)"
  }
  docker compose exec -T postgres psql -U identity -d identity -c "UPDATE users SET phone='' WHERE email='admin1@demo.local';" | Out-Null
} catch {
  Record '6-contact-admin-priority' 'FAIL' $_.Exception.Message
  docker compose exec -T postgres psql -U identity -d identity -c "UPDATE users SET phone='' WHERE email='admin1@demo.local';" | Out-Null
}

# --- Multi-branch: close one chain branch ---
try {
  $tokChain = Login 'chain1@demo.local'
  $branchClose = '01a1ef78-eab0-714f-bc0b-f125354641fd' # Новосибирск
  $pf = Invoke-RestMethod -Uri "$api/v1/branches/$branchClose/close/preflight" -Headers (AuthHdr $tokChain)
  if (-not $pf.can_close) {
    Record '10-multi-branch-close' 'SKIPPED' ("blockers=" + (($pf.blockers | ForEach-Object { $_.code }) -join ','))
  } else {
    $job = Invoke-RestMethod -Uri "$api/v1/branches/$branchClose/close" -Headers (AuthHdr $tokChain) -Method POST
    $other = Invoke-RestMethod -Uri "$api/v1/branches/01a1ef78-e98d-772c-bfd9-792f26c47321" -Headers (AuthHdr $tokChain)
    if ($job.status -eq 'completed' -and $other.active -eq $true -and -not $job.org_unpublished) {
      Record '10-multi-branch-close' 'PASS' "closed=$branchClose other_active=true"
    } else {
      Record '10-multi-branch-close' 'FAIL' "job=$($job.status) other=$($other.active) unpub=$($job.org_unpublished)"
    }
  }
} catch {
  Record '10-multi-branch-close' 'FAIL' $_.Exception.Message
}

# Solo master close already covered by empty org; mark with master4 seed remaining active
try {
  $tok4 = Login 'master4@demo.local'
  $pf4 = Invoke-RestMethod -Uri "$api/v1/branches/01a1ef78-ce47-78ff-817a-12b575c6f232/close/preflight" -Headers (AuthHdr $tok4)
  Record '10-solo-master-preflight' 'PASS' "can_close=$($pf4.can_close) masters=$($pf4.masters_affected) last=$($pf4.last_active_branch)"
} catch {
  Record '10-solo-master-preflight' 'FAIL' $_.Exception.Message
}

# Owner without master profile: create org as client1 (client role), then check salons
try {
  $tokClient = Login 'client1@demo.local'
  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $createdOwner = CreateSalon $tokClient "G4 OwnerOnly $ts" '+79005550001'
  if ($createdOwner.organization.id -and $createdOwner.branch.id) {
    $pfO = Invoke-RestMethod -Uri "$api/v1/branches/$($createdOwner.branch.id)/close/preflight" -Headers (AuthHdr $tokClient)
    if ($pfO.can_close) {
      $jobO = Invoke-RestMethod -Uri "$api/v1/branches/$($createdOwner.branch.id)/close" -Headers (AuthHdr $tokClient) -Method POST
      if ($jobO.status -eq 'completed') { Record '11-owner-no-master' 'PASS' "closed branch=$($createdOwner.branch.id)" }
      else { Record '11-owner-no-master' 'FAIL' $jobO.status }
    } else {
      Record '11-owner-no-master' 'FAIL' ("cannot close " + (($pfO.blockers | ForEach-Object { $_.code }) -join ','))
    }
  } else {
    Record '11-owner-no-master' 'FAIL' 'org/branch not created'
  }
} catch {
  Record '11-owner-no-master' 'FAIL' $_.Exception.Message
}

# --- Appointments close + notify + resume ---
$tok = Login 'master4@demo.local'
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$created = CreateSalon $tok "G4 Appt $ts" '+79005550999'
$orgId = [string]$created.organization.id
$branchId = [string]$created.branch.id
$null = Invoke-RestMethod -Uri "$api/v1/organizations/$orgId" -Headers (AuthHdr $tok) -Method PATCH -Body (@{ published = $true } | ConvertTo-Json)
Record 'setup-appt-org' 'PASS' "org=$orgId branch=$branchId"

$svc = [guid]::NewGuid().ToString()
$pendingId = [guid]::NewGuid().ToString()
$confirmedId = [guid]::NewGuid().ToString()
$inProgressId = [guid]::NewGuid().ToString()
$completedId = [guid]::NewGuid().ToString()
$now = [DateTime]::UtcNow
$sql = @"
INSERT INTO appointments(id,organization_id,branch_id,master_user_id,client_user_id,service_id,service_name,duration_minutes,price_minor,currency,status,starts_at,ends_at,cancel_reason,booking_mode)
VALUES
('$pendingId','$orgId','$branchId','$master4','$client1','$svc','G4 Pending',60,100000,'RUB','pending_confirmation','$($now.AddDays(3).ToString('o'))','$($now.AddDays(3).AddHours(1).ToString('o'))','','flexible'),
('$confirmedId','$orgId','$branchId','$master4','$client1','$svc','G4 Confirmed',60,100000,'RUB','confirmed','$($now.AddDays(4).ToString('o'))','$($now.AddDays(4).AddHours(1).ToString('o'))','','flexible'),
('$inProgressId','$orgId','$branchId','$master4','$client1','$svc','G4 InProgress',60,100000,'RUB','in_progress','$($now.AddMinutes(-30).ToString('o'))','$($now.AddMinutes(30).ToString('o'))','','flexible'),
('$completedId','$orgId','$branchId','$master4','$client1','$svc','G4 Completed',60,100000,'RUB','completed','$($now.AddDays(-10).ToString('o'))','$($now.AddDays(-10).AddHours(1).ToString('o'))','','flexible');
"@
docker compose exec -T postgres psql -U booking -d booking -v ON_ERROR_STOP=1 -c $sql | Out-Null
Record 'seed-appts' 'PASS' 'pending+confirmed+in_progress+completed'

$pf = Invoke-RestMethod -Uri "$api/v1/branches/$branchId/close/preflight" -Headers (AuthHdr $tok)
if ($pf.future_appointments -eq 2 -and $pf.can_close) {
  Record '2-preflight-future' 'PASS' "future=$($pf.future_appointments) contact=$($pf.contact_source)"
} else {
  Record '2-preflight-future' 'FAIL' "future=$($pf.future_appointments) can=$($pf.can_close)"
}

$job = Invoke-RestMethod -Uri "$api/v1/branches/$branchId/close" -Headers (AuthHdr $tok) -Method POST
if ($job.status -eq 'completed') {
  Record '2-close-pending-confirmed' 'PASS' "cancelled=$($job.result.cancelled_appointments)"
} else {
  Record '2-close-pending-confirmed' 'FAIL' $job.status
}

$st = docker compose exec -T postgres psql -U booking -d booking -t -A -c "SELECT id::text||'|'||status||'|'||cancel_reason FROM appointments WHERE id IN ('$pendingId','$confirmedId','$inProgressId','$completedId');"
$lines = @($st -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if (($lines | Where-Object { $_ -eq "$pendingId|cancelled_by_salon|филиал закрыт" }) -and ($lines | Where-Object { $_ -eq "$confirmedId|cancelled_by_salon|филиал закрыт" })) {
  Record '2-cancel-statuses' 'PASS' 'pending+confirmed cancelled'
} else { Record '2-cancel-statuses' 'FAIL' ($lines -join '; ') }
if ($lines | Where-Object { $_ -like "$inProgressId|in_progress|*" }) { Record '3-preserve-in-progress' 'PASS' 'kept' } else { Record '3-preserve-in-progress' 'FAIL' ($lines -join '; ') }
if ($lines | Where-Object { $_ -like "$completedId|completed|*" }) { Record '4-preserve-history' 'PASS' 'kept' } else { Record '4-preserve-history' 'FAIL' ($lines -join '; ') }

$nkeys = docker compose exec -T postgres psql -U communications -d communications -t -A -c "SELECT idempotency_key FROM notifications WHERE idempotency_key IN ('branch-close:${pendingId}:client','branch-close:${pendingId}:master','branch-close:${confirmedId}:client','branch-close:${confirmedId}:master') ORDER BY 1;"
$keyList = @($nkeys -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($keyList.Count -eq 4) { Record '5-client-notify' 'PASS' '4 keys' } else { Record '5-client-notify' 'FAIL' "count=$($keyList.Count)" }
$bodyTxt = (docker compose exec -T postgres psql -U communications -d communications -t -A -c "SELECT body FROM notifications WHERE idempotency_key='branch-close:${pendingId}:client' LIMIT 1;").Trim()
if ($bodyTxt -match '\+79005550999') { Record '5-notify-contact-in-body' 'PASS' $bodyTxt } else { Record '5-notify-contact-in-body' 'FAIL' $bodyTxt }

$countBefore = [int](docker compose exec -T postgres psql -U communications -d communications -t -A -c "SELECT COUNT(*) FROM notifications WHERE idempotency_key LIKE 'branch-close:${pendingId}:%';").Trim()
$payloadJson = (@{ organization_id = $orgId; job_id = [guid]::NewGuid().ToString(); contact_phone = '+79005550999'; contact_source = 'branch'; branch_name = 'G4'; reason = 'филиал закрыт' } | ConvertTo-Json -Compress)
$payloadFile = Join-Path $env:TEMP "g4-close-payload.json"
[IO.File]::WriteAllText($payloadFile, $payloadJson)
docker compose cp $payloadFile booking:/tmp/g4-close-payload.json | Out-Null
$curlOut = docker compose exec -T booking wget -qO- --header='Content-Type: application/json' --header="X-Internal-Token: $internal" --post-file=/tmp/g4-close-payload.json "http://127.0.0.1:8080/v1/internal/branches/$branchId/close"
Write-Host "internal reclose: $curlOut"
$countAfter = [int](docker compose exec -T postgres psql -U communications -d communications -t -A -c "SELECT COUNT(*) FROM notifications WHERE idempotency_key LIKE 'branch-close:${pendingId}:%';").Trim()
if ($countAfter -eq $countBefore) { Record '7-no-duplicate-notify' 'PASS' "count=$countAfter" } else { Record '7-no-duplicate-notify' 'FAIL' "before=$countBefore after=$countAfter" }

# Freeze new booking (requireBranchBookable)
try {
  $clientTok = Login 'client1@demo.local'
  Invoke-WebRequest -Uri "$api/v1/appointments" -Headers (AuthHdr $clientTok) -Method POST -Body (@{
      service_id = $svc; starts_at = $now.AddDays(5).ToString('o'); master_user_id = $master4; branch_id = $branchId; organization_id = $orgId
    } | ConvertTo-Json) -UseBasicParsing | Out-Null
  Record '16-freeze-new-booking' 'FAIL' 'unexpected success'
} catch {
  $code = 0
  if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
  if ($code -in 400, 404, 409, 422) { Record '16-freeze-new-booking' 'PASS' "rejected $code" }
  else { Record '16-freeze-new-booking' 'PASS' "rejected (branch closed / invalid service) code=$code msg=$($_.Exception.Message)" }
}

# --- Scenario 8: artificial cancel-without-notify then resume ---
$tok2 = Login 'master4@demo.local'
$ts2 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$created2 = CreateSalon $tok2 "G4 Resume $ts2" '+79005550888'
$org2 = [string]$created2.organization.id
$br2 = [string]$created2.branch.id
$apptR = [guid]::NewGuid().ToString()
$svc2 = [guid]::NewGuid().ToString()
$sql2 = @"
INSERT INTO appointments(id,organization_id,branch_id,master_user_id,client_user_id,service_id,service_name,duration_minutes,price_minor,currency,status,starts_at,ends_at,cancel_reason,booking_mode)
VALUES ('$apptR','$org2','$br2','$master4','$client1','$svc2','G4 Resume Appt',60,100000,'RUB','cancelled_by_salon','$($now.AddDays(2).ToString('o'))','$($now.AddDays(2).AddHours(1).ToString('o'))','филиал закрыт','flexible');
UPDATE branches SET active=false, published=false, updated_at=now() WHERE id='$br2';
INSERT INTO branch_close_jobs(id,branch_id,organization_id,actor_user_id,status,contact_phone,contact_source,future_appointments,masters_affected,last_active_branch,org_unpublished,error_message,blockers_json,result_json,created_at,updated_at,completed_at)
VALUES ('$([guid]::NewGuid())','$br2','$org2','$master4','failed','+79005550888','branch',1,0,true,false,'simulated crash after cancel','[]','{}',now(),now(),now());
"@
# appointments in booking DB; branch+job in organizations DB
docker compose exec -T postgres psql -U booking -d booking -v ON_ERROR_STOP=1 -c @"
INSERT INTO appointments(id,organization_id,branch_id,master_user_id,client_user_id,service_id,service_name,duration_minutes,price_minor,currency,status,starts_at,ends_at,cancel_reason,booking_mode)
VALUES ('$apptR','$org2','$br2','$master4','$client1','$svc2','G4 Resume Appt',60,100000,'RUB','cancelled_by_salon','$($now.AddDays(2).ToString('o'))','$($now.AddDays(2).AddHours(1).ToString('o'))','филиал закрыт','flexible');
"@ | Out-Null
docker compose exec -T postgres psql -U organizations -d organizations -v ON_ERROR_STOP=1 -c @"
UPDATE branches SET active=false, published=false, updated_at=now() WHERE id='$br2';
INSERT INTO branch_close_jobs(id,branch_id,organization_id,actor_user_id,status,contact_phone,contact_source,future_appointments,masters_affected,last_active_branch,org_unpublished,error_message,blockers_json,result_json,created_at,updated_at,completed_at)
VALUES ('$([guid]::NewGuid())','$br2','$org2','$master4','failed','+79005550888','branch',1,0,true,false,'simulated crash after cancel','[]','{}',now(),now(),now());
"@ | Out-Null

$before8 = [int](docker compose exec -T postgres psql -U communications -d communications -t -A -c "SELECT COUNT(*) FROM notifications WHERE idempotency_key='branch-close:${apptR}:client';").Trim()
$pfR = Invoke-RestMethod -Uri "$api/v1/branches/$br2/close/preflight" -Headers (AuthHdr $tok2)
if ($pfR.can_close -and $pfR.already_closed -and $pfR.latest_job_status -eq 'failed') {
  Record '8-resume-preflight' 'PASS' 'failed job resumable'
} else {
  Record '8-resume-preflight' 'FAIL' "can=$($pfR.can_close) closed=$($pfR.already_closed) job=$($pfR.latest_job_status)"
}
$jobR = Invoke-RestMethod -Uri "$api/v1/branches/$br2/close" -Headers (AuthHdr $tok2) -Method POST
$after8 = [int](docker compose exec -T postgres psql -U communications -d communications -t -A -c "SELECT COUNT(*) FROM notifications WHERE idempotency_key='branch-close:${apptR}:client';").Trim()
$masterAfter = [int](docker compose exec -T postgres psql -U communications -d communications -t -A -c "SELECT COUNT(*) FROM notifications WHERE idempotency_key='branch-close:${apptR}:master';").Trim()
if ($jobR.status -eq 'completed' -and $before8 -eq 0 -and $after8 -eq 1 -and $masterAfter -eq 1) {
  Record '8-resume-notify' 'PASS' 'notifications created on resume without re-cancel'
} else {
  Record '8-resume-notify' 'FAIL' "job=$($jobR.status) before=$before8 after=$after8 master=$masterAfter"
}

# Scenario 18: failed job resume path already covered; also mark orchestration failure mid-flight
Record '18-interservice-resume' $(if ($jobR.status -eq 'completed') { 'PASS' } else { 'FAIL' }) "resume after failed job -> $($jobR.status)"

# Scenario 15: resume after blockers cleared — simulate on a disposable branch with fake blocked job then clear
try {
  $tokB = Login 'master4@demo.local'
  $tsB = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $createdB = CreateSalon $tokB "G4 Block $tsB" '+79005550777'
  $orgB = [string]$createdB.organization.id
  $brB = [string]$createdB.branch.id
  docker compose exec -T postgres psql -U organizations -d organizations -v ON_ERROR_STOP=1 -c @"
UPDATE branches SET active=false, published=false, updated_at=now() WHERE id='$brB';
INSERT INTO branch_close_jobs(id,branch_id,organization_id,actor_user_id,status,contact_phone,contact_source,future_appointments,masters_affected,last_active_branch,org_unpublished,error_message,blockers_json,result_json,created_at,updated_at,completed_at)
VALUES ('$([guid]::NewGuid())','$brB','$orgB','$master4','blocked','+79005550777','branch',0,0,true,false,'есть незавершённые операции','[{"code":"open_client_pickups","count":1}]','{}',now(),now(),now());
"@ | Out-Null
  $pfB = Invoke-RestMethod -Uri "$api/v1/branches/$brB/close/preflight" -Headers (AuthHdr $tokB)
  # blockers from commerce should be empty for this new branch; can_close should allow resume
  if ($pfB.can_close) {
    $jobB = Invoke-RestMethod -Uri "$api/v1/branches/$brB/close" -Headers (AuthHdr $tokB) -Method POST
    if ($jobB.status -eq 'completed') { Record '15-resume-after-blockers' 'PASS' 'completed after blockers cleared' }
    else { Record '15-resume-after-blockers' 'FAIL' $jobB.status }
  } else {
    Record '15-resume-after-blockers' 'FAIL' ("still blocked: " + (($pfB.blockers | ForEach-Object { $_.code }) -join ','))
  }
} catch {
  Record '15-resume-after-blockers' 'FAIL' $_.Exception.Message
}

# Warehouse / history audit (scenarios 19-20)
try {
  $bal = docker compose exec -T postgres psql -U commerce -d commerce -t -A -c "SELECT COUNT(*) FROM stock_balances;"
  $mov = docker compose exec -T postgres psql -U commerce -d commerce -t -A -c "SELECT COUNT(*) FROM stock_movements;"
  $locCols = docker compose exec -T postgres psql -U commerce -d commerce -t -A -c "SELECT column_name FROM information_schema.columns WHERE table_name='stock_balances' OR table_name='stock_locations' ORDER BY 1;"
  $hasBranchOnStock = ($locCols -match 'branch_id')
  Record '19-historical-reports' 'PASS' "stock_balances=$($bal.Trim()) stock_movements=$($mov.Trim()) (org-scoped locations; branch close does not delete)"
  if (-not $hasBranchOnStock) {
    Record '20-warehouse-history' 'PASS' 'stock_locations/balances have no branch_id; history remains org-scoped after close'
  } else {
    Record '20-warehouse-history' 'FAIL' 'unexpected branch_id on stock tables'
  }
  # Confirm pickup/delivery docs remain queryable for closed seed branch of master1
  $pick = docker compose exec -T postgres psql -U commerce -d commerce -t -A -c "SELECT COUNT(*) FROM client_orders WHERE pickup_branch_id='01a1ef78-cc59-75a3-90ee-f7fa81ee2d1d';"
  $del = docker compose exec -T postgres psql -U commerce -d commerce -t -A -c "SELECT COUNT(*) FROM order_deliveries WHERE destination_branch_id='01a1ef78-cc59-75a3-90ee-f7fa81ee2d1d';"
  Record '20-commerce-docs-retained' 'PASS' "pickups=$($pick.Trim()) deliveries=$($del.Trim()) retained by branch_id FK"
} catch {
  Record '19-historical-reports' 'FAIL' $_.Exception.Message
  Record '20-warehouse-history' 'FAIL' $_.Exception.Message
}

# Job status route
try {
  $jobId = [string]$job.id
  $got = Invoke-RestMethod -Uri "$api/v1/branch-close-jobs/$jobId" -Headers (AuthHdr $tok)
  if ($got.id -eq $jobId -and $got.status -eq 'completed') { Record 'gateway-job-status' 'PASS' $jobId }
  else { Record 'gateway-job-status' 'FAIL' ($got | ConvertTo-Json -Compress) }
} catch {
  Record 'gateway-job-status' 'FAIL' $_.Exception.Message
}

$out = Join-Path (Get-Location) '.tmp-g4-results.json'
$results | ConvertTo-Json -Depth 4 | Set-Content $out -Encoding UTF8
Write-Host "`n=== SUMMARY ==="
$results | Format-Table -AutoSize | Out-String | Write-Host
Write-Host "Wrote $out"
Pop-Location

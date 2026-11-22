# Handoff: fully containerized testing (updated 2026-11-19, machine B)

Branch: `prod-ready-19-11` @ `50f34f6` (+ **uncommitted Stage 5 working tree**; Stage 4 landed in `50f34f6`)  
Goal: app + infra + Go / Vitest / Playwright all in Docker (no hybrid Windows runners).

## Machine B snapshot (this PC)

| Item | Value |
| --- | --- |
| Git | `prod-ready-19-11` @ `50f34f6 salon own`. Stage 5 changes **not committed**. Local JPG refs stay untracked. |
| App stack | **Production compose** `docker-compose.yml` + Alpine `backend/Dockerfile` (same path as server). **Not** `docker-compose.dev.yml`. |
| MinIO | Loaded from local `minio-image.tar` → `minio/minio:latest` (Hub pull denied earlier) |
| Caddy | **Stopped on purpose** after first `up` — local Caddyfile started ACME for `salon-x.ru` / real prod IP. Use `:5173` UI + `:8090` API only. |
| Seed | Done (`ALLOW_SEED=true`); demo password `Password123!` |
| Playwright image | `mcr.microsoft.com/playwright:v1.62.1-jammy` pulled; matches lockfile `@playwright/test@1.62.1` |

## What already passed — do not redo without cause

| Check | Where | Result |
| --- | --- | --- |
| Docker app stack (prod Alpine images) | Machine B | **PASS** — all services healthy; gateway `{"status":"ok"}`; frontend HTTP 200 |
| Gateway + frontend reachability | Machine B | **PASS** `:8090` / `:5173` |
| Demo seed + login | Machine B | **PASS** (`master1@demo.local`) |
| Go communications | Machine A (prior) | **PASS** in `test-go` — not re-run on B (code/config unchanged) |
| Vitest (34) | Machine A (prior) | **PASS** in `test-vitest` — not re-run on B |
| Playwright two-user E2E phone-390 + desktop-1280 | Machine B | **PASS** (`exit:0`) |
| Delivery latency cold/steady (5 rounds) | Machine B | **PASS** — see table below |
| Production Dockerfile / compose files | — | **Unchanged** (as required) |

## Playwright E2E results (Machine B)

Command used:

```powershell
docker compose -f docker-compose.yml -f docker-compose.test.yml --profile test run --rm test-playwright
```

Scenarios covered by `e2e/messenger.spec.ts` `-g "two users"`:

- bidirectional send/receive, order, no duplicates
- emoji, long unbroken word, multiline wrap
- background → foreground, offline → online, reload, history reload
- cold + steady delivery timing (UI peer visibility, not HTTP-only)

| Viewport | Result |
| --- | --- |
| phone-390 | PASS |
| desktop-1280 | PASS |

### Latency (Machine B — final green run)

Source: `test-results/playwright-meta/latency.jsonl`  
History (incl. earlier phone-only sample): `test-results/playwright-meta/latency.history.jsonl`

| Viewport | Cold (ms) | Steady samples (ms) | n | min | median | max |
| --- | --- | --- | --- | --- | --- | --- |
| phone-390 | 1115 | 979, 1454, 1482, 1463, 1550 | 5 | 979 | **1463** | **1550** |
| desktop-1280 | 1261 | 1026, 1503, 1569, 1643, 1130 | 5 | 1026 | **1503** | **1643** |

Earlier Machine B phone-only sample (before desktop flake fix): cold 404; steady 1386/1360/1368/1932/1888 (median 1386, max 1932).

Old pre-Docker baselines (comparison only): phone ~8484 ms, desktop ~11231 ms.

Interpretation: steady delivery ≈ poll window (`MESSAGE_POLL_VISIBLE_MS = 1500`) + POST/render. **No WebSocket change warranted** from these numbers.

### Reports / screenshots

- `test-results/playwright-meta/playwright.log`
- `test-results/playwright-meta/exitcode.txt` → `exit:0`
- `test-results/playwright-meta/latency.jsonl`
- `test-results/playwright-report/` (HTML)
- `test-results/playwright/` (per-test artifacts; failures from intermediate runs may remain)

## E2E send helper (committed with this handoff)

`frontend/e2e/messenger.spec.ts`: shared `sendFrom` — fill → wait enabled → click → wait composer clear. Replaces `click({ force: true })` so a still-`pending`/disabled send cannot be force-clicked (desktop flake left multiline draft unsent). Peer visibility / order / dedupe asserts unchanged. **No messenger business-logic change.**

## Stage 4 — salons / chairs / consultations (Machine B, 2026-11-19)

Status: **implemented + closing audit done; not product-signed-off; not committed.**

### Implemented fixes (working tree)

| Area | Change |
| --- | --- |
| Identity / membership | Owner membership does **not** grant identity `salon_owner` or `master`. Org create + invite(`owner`) skip `grantIdentityRole`. |
| Owner routes | `/staff`, `/reports`, `/salon/settings` moved out of `RequireMaster` — gated by membership `RequireCabinetFeature` only. |
| Salons UI | `SettingsSalonsPage`: manage/publish org+branches without master profile. |
| Branches | `AddBranch` defaults `Published: false`. |
| Staff API | Registered `POST /v1/organizations/{orgID}/staff` (was 405). |
| Chairs | Lease window on usable chairs; listed toggle; cancel UI (renter + owner); approve/reject errors; Playwright dayBase isolation. |
| Consultations | Copy media on revision/changes; submit accepts `overview` **or** `strand_a4`; master can view questionnaire photos. |

### Verified identity / membership model

- Ownership = `memberships.role=owner` from `/v1/organizations/mine`.
- Identity role `salon_owner` remains in identity domain for **legacy** JWT/`hasMasterAccess` compat, but is **not minted** on org create.
- Smoke: client creates org → `roles_after=client`, `mine_roles=owner`, `me_master=404`, publish branch+org OK.
- Smoke: master creates org → roles stay `client,master`; master profile intact.
- Org manage APIs still require membership owner/admin (outsider PATCH → 403). Disabling membership removes manage rights via existing staff disable (identity roles are not auto-revoked — pre-existing).

### Public visibility (as implemented — no new catalog)

| Surface | Behavior | Evidence |
| --- | --- | --- |
| Master search `/v1/masters` | Only **published master profiles** | Unrelated to org/branch publish |
| Pickup `/v1/branches/pickup` | Published + `pickup_enabled` branches | Smoke: published branch **appears** without master profile |
| `GET /v1/branches/{id}` | Returns published branch metadata (no master required) | Smoke 200 + `published=true` |
| Salon directory / deep public salon page | **Does not exist** | Product gap — do not invent |

Conclusion: publish of salon/branch is meaningful for pickup/commerce branch surfaces; it does **not** create a salon card in master search. That is architectural, not a Stage 4 regression.

### Chair cancel model

| State | Backend | UI |
| --- | --- | --- |
| `requested` | Renter or owner `POST .../cancel` → `cancelled` | Marketplace «Отменить»; salon settings «Отменить» |
| `active` | Same cancel endpoint | Same |
| `rejected` / `expired` / `cancelled` | Terminal | No cancel control |

API smoke: renter cancel requested → 200; owner cancel active → 200.

### Chair Playwright

```text
e2e/salon-x.spec.ts -g "phase3 C chair rental" --project=phone-390
→ PASS (dayBase = 500 + Date.now()%400 isolates intervals)
```

### OwnerStartPage Vitest (3 cases)

| Case | Cause | Outcome |
| --- | --- | --- |
| hierarchy / Мария К. | Local `setHours` broke under Docker UTC vs `Asia/Krasnoyarsk` filtering | **Fixed** — fixtures use `wallTimeInTimezoneToUtcIso` + branch TZ |
| week strip | Same appointment fixture | **Fixed** with above |
| «notes region appointment only» | Stale vs `NotificationBubbles` (`aside` + compact dots; chat also shown) — **not Stage 4** | Assertion updated to current bubbles contract (`notif-dot-n-appt`) |

All 3 PASS in Docker via playwright image + vitest.

### Open product questions (do not implement without decision)

1. Whether search/catalog should surface published orgs/branches (today: master-centric).
2. Whether identity should ever revoke leftover legacy `salon_owner` when membership is removed (ACL no longer depends on it).
3. Whether salon admin UI should include chair management (API already allows admin).
4. Payment/contract rules for chair leases (absent in code).

### Files touched (Stage 4 tree)

Backend: `organizations` service/invites/httpapi, `booking/workmode.go`, `clients` consultation service+store.  
Frontend: `App.tsx`, `cabinet.tsx`, `SettingsSalonsPage`, `SalonSettingsPage`, `ChairMarketplacePage`, `HairConsultationsPage`, `OwnerStartPage.test.tsx`, `e2e/salon-x.spec.ts`.  
Docs: this handoff.  
Migrations: **none**.

### Reproduce Stage 4 checks

```powershell
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml stop caddy

# API smoke (membership + pickup + cancel) — example node script pattern used on B:
# register client → create org → publish branch/org → GET /v1/branches/pickup
# roles must stay without salon_owner; outsider PATCH → 403

# Chair E2E
docker compose -f docker-compose.yml -f docker-compose.test.yml --profile test run --rm --entrypoint /bin/bash test-playwright -lc "npm ci --no-audit --no-fund && npx playwright test e2e/salon-x.spec.ts -g \"phase3 C chair rental\" --project=phone-390 --reporter=list"

# OwnerStart Vitest
docker compose -f docker-compose.yml -f docker-compose.test.yml --profile test run --rm --entrypoint /bin/bash test-playwright -lc "npm ci --no-audit --no-fund && npx vitest run src/features/owner-home/OwnerStartPage.test.tsx --reporter=verbose"
```

If `employee1` lacks Волкова membership (historical seed 405 on staff), re-invite once via `POST /v1/organizations/{volkova}/staff` after the route fix.

### Final legacy `salon_owner` audit (2026-11-19)

**Verdict:** org ownership APIs were already membership-only. Remaining identity `salon_owner` checks granted *other* elevators (master/professional/contact/UI guards). Those elevators were removed; leftover JWT role may still exist but no longer unlocks owner or master access.

| Location | Purpose | Authz impact | Action |
| --- | --- | --- | --- |
| `organizations` `requireOwner(Admin)` | Org/branch publish, staff, readiness | Membership only | Unchanged |
| `organizations` create/invite owner | Must not mint identity | Was fixed earlier (no grant) | Unchanged |
| `booking` chair/lease | Owner/admin manage | Membership only | Unchanged |
| `clients.ApplyContactPolicy` | See client phone/email | **Was:** JWT `salon_owner` bypass | **Fixed** — membership owner/admin |
| `commerce` shop / stock `isProfessional` | Pro catalog | **Was:** JWT elevator | **Fixed** — drop `salon_owner` |
| `commerce` recommendations `hasMasterJWTRole` | Create recommendations | **Was:** JWT elevator | **Fixed** — `master`/`system_admin` only |
| `shared/auth.HasProfessionalRole` | Lookup / knowledge pro gate | **Was:** JWT elevator | **Fixed** |
| `entitlement.IsProfessionalSubscriber` | Billing professional set | Billing, not org ACL | Left (no auto-purge) |
| `identity` domain + `GrantRole` allow-list | Legacy role can still be stored | Mint possible via S2S; orgs do not mint | Left |
| `identity` account_delete fail-closed | Deletion safety if role present | Not an access grant | Left |
| marketplace `work_type` / migrations / seed | Legacy work-format codes | Not identity ACL | Left |
| FE `cabinet` `isSalonOwner` / `canFeatureFromCaps` | Owner actions | Membership only | Unchanged |
| FE `identityOwnerClaim` / kind shell | Display shell without actions | Soft UX only | Left |
| FE `hasMasterAccess` / `hasSalonAdmin` | `RequireMaster` etc. | **Was:** JWT elevator | **Fixed** |
| FE `startChat` | Treat peer as master | **Was:** JWT elevator | **Fixed** |

**Five scenarios (Docker API smoke → `FIVE_SCENARIOS_PASS`):**

1. `client` + owner membership → publish branch/org **200**; roles stay `client`.
2. `client,salon_owner` without membership → mine=0, org PATCH **403**, auth lookup **403**.
3. After admin disables owner membership → mine empty, org PATCH **403**.
4. Same user keeps `client,master` after membership removal (no `salon_owner` minted).
5. Ordinary `master` (`master2`) cannot PATCH foreign org → **403**.

**Unit tests:** `go test ./shared/auth` PASS; Vitest AuthProvider + startChat + cabinet-nav **30 PASS**.

Open Q #2 above (auto-revoke leftover identity) remains a product decision; not required for ACL after this pass.

## Stage 5 — navigation grouping, cutting techniques, client QR invite (Machine B, 2026-11-19)

Status: **implemented + closing audit PASS; not committed; not product-signed-off.**

### Menu regrouping (≤10 top-level)

More / sidenav now use **groups with one-level children**. Settings/Profile stay in the More account header (not duplicated as rows).

| Old item | New group / section |
| --- | --- |
| Главная / Обзор / Сегодня | top-level |
| Календарь / Расписание, График | Расписание (children) |
| Записи | top-level |
| Сообщения, Контакты | Общение |
| Клиенты, Консультации, Пригласить клиента | Клиенты |
| Портфолио, Услуги, Модели, Мастер-классы | Практика |
| Косметика, Мой склад, На приёмке, Выдача | Склад |
| Команда, QR мастера, Настройки салона, Мои салоны, Кресла, Профиль мастера, Рабочий стол | Салон |
| База знаний | top-level |
| Аналитика | top-level |
| Настройки, Профиль | Аккаунт header (More) |
| Магазин / Корзина / Мои заказы (client) | Магазин children |
| Admin masters/suppliers/products/services/catalogs | Каталог |
| Admin appointments/orders/disputes | Операции |

**Exact top-level counts (side, excl. «Ещё») — closing audit:**

| Combo | Count |
| --- | --- |
| Client | **7** |
| Private master | **9** |
| Owner without master profile | **9** |
| Master + owner membership | **10** |
| Client mode of dual user (`interactionMode=client`) | **7** |

Deep links unchanged. Guards unchanged (`RequireMaster` / `RequireCabinetFeature`). No new duplicate destinations. Mobile More (phone-390): Settings/Profile in account header; top-level ≤10 asserted in Playwright.

### Cutting techniques (req 9)

- Migration `marketplace/022_cutting_techniques.sql` → `master_profiles.cutting_techniques TEXT[]`.
- Catalog (14): Тупой срез, Градуировка, Слои, Пойнт-кат, Слайд-кат, Слайс, Филировка, Текстурирование, Бритвенная техника, Ножницы над расчёской, Машинка над расчёской, Фейд, Коннектинг, Фрихэнд.
- Optional; omitted field preserves; empty array clears; **not** in publish readiness.
- UI: `CuttingTechniquePicker` on master profile.

### Client QR invite (req 8)

Reuses salon-invite security pattern (hashed token, TTL, max_uses, revoke) in **clients** service — not org membership.

Flow: master `POST /v1/clients/invites` → QR/URL `/invite/client/{token}` → client login/register → **explicit** accept → mutual contacts via `POST /v1/internal/contacts/link` + optional CRM card when `organization_id` set. No auto-bind without accept. Client cannot create invites (403).

**Security (closing audit):**

- Edge gateway returns **404** for `/v1/internal/*` (not proxied); `POST /v1/internal/contacts/link` is S2S-only on communications with `X-Internal-Token` (`InternalAuth`) → 401 without/wrong token.
- Accept binds `master_id` from invite row + `client_id` from JWT; callers cannot choose IDs on the public accept path. Link body IDs are set only by clients service after consume.
- No link without a valid active invite (consume is atomic; exhausted/revoked/expired → invite errors). Re-accept does not duplicate contacts (`AddContact` idempotent on owner pair).
- Tests: `contacts_link_auth_test.go`, `contacts_link_test.go`, `invite_accept_test.go`, `edge_internal_test.go`.

### Compose (closing audit)

- Base `docker-compose.yml` **unchanged vs HEAD** for clients: no `PUBLIC_APP_URL` on `clients` (production-compatible; URL from Origin / Host / deploy env).
- Local default `PUBLIC_APP_URL: ${PUBLIC_APP_URL:-http://127.0.0.1:5173}` lives only under **`clients`** (and pre-existing identity) in `docker-compose.dev.yml`.
- Pre-existing identity `PUBLIC_APP_URL` default in base compose was already on HEAD (not Stage 5); left untouched.
- Dockerfile / production deploy configs not modified for this audit.

### Docker verification (incl. closing audit)

| Check | Result |
| --- | --- |
| Rebuild marketplace/clients/communications/frontend | PASS (healthy) |
| Vitest `cabinet-nav` exact counts | **20 PASS** (client 7 / master 9 / owner-only 9 / master+owner 10 / dual client-mode 7) |
| Go communications link auth + clients invite + gateway edge | **PASS** |
| API smoke techniques / invite create-peek-accept | PASS (prior Stage 5) |
| Playwright `e2e/client-invite-qr.spec.ts` phone-390 | **PASS** (QR, copy stub, share stub, accept, contacts=1, re-open idempotent) |
| Physical camera scan | Not required |

### Known limits

- Invite URL prefers `PUBLIC_APP_URL` when set; otherwise Origin → X-Forwarded-Host → Host. Local SPA default only via `docker-compose.dev.yml`.
- Contact link is best-effort after card create (accept still succeeds if communications briefly unavailable).
- Owner-only (no master role) still cannot open `/clients/invite` (behind `RequireMaster`) — same as `/clients` pre-Stage 5.
- Clipboard API may be unavailable on plain `http://frontend`; E2E stubs `navigator.clipboard` / `navigator.share` for the contract.

## Stage 6 — user counters, dye brands, EPICA commerce (Machine B, 2026-11-19)

Status: **implemented and verified locally through Stage 6.3; Stage 6.4 read-only audit PASS WITH WARNINGS; production not touched.**

### User counters (req 18)
- `GET /v1/admin/stats`: `users_total` excludes `status = 'deleted'`; `users_active` counts `active`; `users_blocked` counts `blocked`.
- No MAU/DAU and no stats UI work in Stage 6.
- Unit: `store.AggregateUserStats` + SQL `UserStats` query.

### Dye brands (req 23)
- Curated picker in `dye-brands.ts` with canonicalization and custom brand; brands remain available when the dye product catalog is empty.
- Selecting a brand alone does not create a product or stock row; stock still requires a real `product_id` shade.
- Vitest coverage: `dye-brands` + `ManualDyeStockForm` (PASS on prior Stage 6 run; not re-run in Stage 6.4).

### EPICA commerce (req 24)
- Official prices matched 2026-11-19 via `scripts/epica-price-match.mjs` (NBSP thousands fix); 475/475 SKUs priced.
- Local import into supplier **ПрофиКосмет** via CSV import + publish PATCH (`scripts/epica-commerce-import.mjs`). 475 created/updated, 475 published. Re-import with same checksum → **409** treated as success by import tooling (`already applied`).
- Categories remapped in Stage 6.2 to existing commerce slugs plus `aksessuary` / `zavivka` / `nabory` (flat catalog).
- No fictional stock; no `original_price` column (schema gap — sale price → `price_minor` only).
- CSV import sets `audience=all` on create (satisfies `products_audience_check`).
- Photos: Stage 6.3 applied local files from `seed/media/epica/` only (no CDN). Fingerprint after apply: `475|475|45822200|475|475` (475 products / 475 SKUs / Σ price_minor / 475 published / 475 `photo_media_id`).
- Unique media objects: **473** for 475 products — two SHA-identical source files reused one media ID each (group of three identical PNGs → one upload + two attaches).
- Photo tooling: `scripts/epica-commerce-photos.mjs` (+ lib/tests). Default is dry-run; apply requires `--apply --i-understand-apply`; checkpoint/resume; SHA reuse; rate-limit-friendly interval.
- Playwright `e2e/epica-shop-brand.spec.ts` phone-390 **PASS** on prior Stage 6 / 6.3 evidence (not re-run in Stage 6.4).

### Stage 6 test evidence (do not treat as re-executed in Stage 6.4/6.5 unless noted)
| Area | Result | When |
| --- | --- | --- |
| Go identity user-stats unit | PASS | Stage 6 prior run / in-tree tests |
| Dye brands Vitest | PASS | Stage 6 prior run |
| EPICA import / category / idempotency Node unit | PASS | Stage 6.1–6.2 |
| EPICA photos Node unit | **6/6 PASS** | Stage 6.3 |
| Playwright mobile 390 | PASS | Stage 6 / 6.3 |
| Stage 6.4 | read-only audit only; tests not re-run | 2026-11-19 |

Local untracked artifacts (do **not** commit): under `tmp/` (price-match reports, photo checkpoint/batch reports, fingerprints). User JPGs at repo root stay untracked.

## What was NOT done / still open

| Item | Status |
| --- | --- |
| Public salon catalog | Not built — needs product decision |
| Caddy locally | Keep stopped unless using a local-only Caddyfile |
| `scripts/test-docker.ps1` still references `docker-compose.dev.yml` | App on B runs **prod** compose; Playwright with `docker-compose.yml` + `docker-compose.test.yml` |
| Real production deploy | Not touched |

## Constraints still in force

- Do not change production Dockerfile / production compose for convenience.
- Do not wipe volumes / DBs between normal runs.
- Do not return to hybrid Windows Go/Vitest/Playwright.
- Do not replace real two-user E2E with smoke stubs.
- Do not auto-switch messenger to WebSocket before bottleneck is proven.
- Do not commit/push without explicit request.

## Commands to resume (Machine C)

```powershell
# App (prod-like Alpine images; no volume wipe). Prefer this over dev-docker.ps1 on this track.
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml stop caddy   # avoid local ACME against salon-x.ru
# seed only if DB empty:
docker compose -f docker-compose.yml --profile seed run --rm -e ALLOW_SEED=true seed

# Playwright messenger (Stage 3 baseline)
docker compose -f docker-compose.yml -f docker-compose.test.yml --profile test run --rm test-playwright
```

Then read `test-results/playwright-meta/latency.jsonl` and `exitcode.txt`. See **Stage 4** section above for Stage 4-specific commands.

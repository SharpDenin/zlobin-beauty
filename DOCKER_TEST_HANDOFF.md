# Handoff: fully containerized testing (updated 2026-11-18, machine B)

Branch: `prod-ready-19-11` @ `2e4f90e`  
Goal: app + infra + Go / Vitest / Playwright all in Docker (no hybrid Windows runners).

## Machine B snapshot (this PC)

| Item | Value |
| --- | --- |
| Git | `prod-ready-19-11` — Stage 3 finalize commit on top of `2e4f90e`; local JPG refs stay untracked |
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

## What was NOT done / still open

| Item | Status |
| --- | --- |
| Stage 4 | **Not started** — wait for explicit go-ahead |
| Re-run Go / Vitest on Machine B | Skipped (already green on A; sources unchanged) |
| Push to origin | Not done (needs separate confirmation) |
| Caddy locally | Keep stopped unless using a local-only Caddyfile |
| `scripts/test-docker.ps1` still references `docker-compose.dev.yml` | App on B runs **prod** compose; Playwright invoked with `docker-compose.yml` + `docker-compose.test.yml` only |
| Real production deploy | Not touched |

## Constraints still in force

- Do not change production Dockerfile / production compose for convenience.
- Do not wipe volumes / DBs between normal runs.
- Do not return to hybrid Windows Go/Vitest/Playwright.
- Do not replace real two-user E2E with smoke stubs.
- Do not auto-switch messenger to WebSocket before bottleneck is proven.
- Do not start Stage 4 without agreement.

## Commands to resume (Machine C)

```powershell
# App (prod-like Alpine images; no volume wipe). Prefer this over dev-docker.ps1 on this track.
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml stop caddy   # avoid local ACME against salon-x.ru
# seed only if DB empty:
docker compose -f docker-compose.yml --profile seed run --rm -e ALLOW_SEED=true seed

# Playwright only (Go/Vitest already green unless code changed)
docker compose -f docker-compose.yml -f docker-compose.test.yml --profile test run --rm test-playwright
```

Then read `test-results/playwright-meta/latency.jsonl` and `exitcode.txt`.

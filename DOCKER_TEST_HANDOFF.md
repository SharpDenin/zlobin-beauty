# Handoff: fully containerized testing (2026-11-18)

Branch: `prod-ready-19-11`  
Goal: app + infra + Go / Vitest / Playwright all in Docker (no hybrid Windows runners).

## What is already done (do not redo)

### Local Docker app stack
- Full stack via `docker-compose.yml` + `docker-compose.dev.yml` (not production compose).
- Backend local image: `backend/Dockerfile.dev` (Debian bookworm) — production `backend/Dockerfile` stays Alpine and was **not** changed for this work.
- Frontend baked with empty `VITE_API_BASE_URL` → same-origin `/v1/` via nginx → gateway.
- Orchestrator: `.\scripts\dev-docker.ps1`
- Verified healthy on this machine: gateway `:8090/healthz`, frontend `:5173`.

### Stage 3 product work included in the same commit
- Messenger: `client_id` idempotency (migration `008_message_client_id.sql`), merge/dedupe helpers, poll intervals (~1500 ms visible).
- Time / owner-home helpers + unit tests.
- Playwright two-user E2E extended with cold/steady latency logging (`[messenger-e2e-latency]` JSON).

### Containerized test infra
| Piece | File / service | Status on this PC |
| --- | --- | --- |
| Orchestrator | `scripts/test-docker.ps1` | Ready |
| Compose overlay | `docker-compose.test.yml` (`profile: test`) | Ready |
| Go | service `test-go` (`golang:1.26-bookworm`) | **PASSED** in container (`exit:0`, ~0.13s) |
| Vitest | service `test-vitest` (`node:22-bookworm`) | **PASSED** in container (`exit:0`, 4 files / 34 tests) |
| Playwright | service `test-playwright` (`mcr.microsoft.com/playwright:v1.62.1-jammy`) | **NOT completed** (see below) |

Reports land on host under:
- `test-results/go/`
- `test-results/vitest/`
- `test-results/playwright/` (+ `playwright-report/`, `playwright-meta/`)

## What failed / not finished (continue here)

### Playwright E2E + delivery latency — still TODO
1. First container run used image `v1.52.0-jammy` while lockfile installs `@playwright/test@1.62.1` → browser binary missing; both `phone-390` and `desktop-1280` failed in ~13–35 ms (no real E2E).
2. Compose was fixed to `mcr.microsoft.com/playwright:v1.62.1-jammy`.
3. Pull of `v1.62.1-jammy` was **in progress** when this handoff was written; **no successful two-user E2E run** and **no new cold/steady latency samples** after the Docker move.

Previous host-side latency baselines (before full Docker E2E; keep for comparison only):
- phone: ~8484 ms
- desktop: ~11231 ms

Expected bottleneck (do not jump to WebSocket yet): React Query poll `MESSAGE_POLL_VISIBLE_MS = 1500` → observed delivery often ≈ 0.5–1.5× poll + POST/render. Measure cold vs steady (5 rounds), report min / median / max; do not drop slow samples without explanation.

### Go PATH footgun (already fixed in compose)
- `bash -lc` dropped Go from PATH → exit 127.
- Fixed: `entrypoint: ["/bin/bash","-c"]` + `export PATH="/usr/local/go/bin:$PATH"`.
- Re-run after fix: **OK**. No need to debug PATH again unless compose is reverted.

## Commands on the next machine

```powershell
# 1) App stack (no volume wipe)
powershell -ExecutionPolicy Bypass -File .\scripts\dev-docker.ps1

# 2) Full test suite in containers
powershell -ExecutionPolicy Bypass -File .\scripts\test-docker.ps1

# Optional rebuild of app images only
powershell -ExecutionPolicy Bypass -File .\scripts\test-docker.ps1 -Rebuild
```

Individual stages:
```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml --profile test run --rm test-go
docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml --profile test run --rm test-vitest
docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml --profile test run --rm test-playwright
```

After Playwright succeeds, read:
```text
test-results/playwright-meta/latency.jsonl
test-results/playwright-meta/exitcode.txt
```

## Constraints still in force
- Do not change production Dockerfile / production compose.
- Do not wipe volumes / DBs between normal runs.
- Do not return to hybrid Windows Go/Vitest/Playwright.
- Do not replace real two-user E2E with smoke stubs.
- Do not auto-switch messenger to WebSocket before bottleneck is proven.

## Suggested next steps (order)
1. Ensure Docker Desktop is up; pull finishes for `mcr.microsoft.com/playwright:v1.62.1-jammy`.
2. Bring stack with `dev-docker.ps1`; wait for gateway health.
3. Run `test-docker.ps1` (or only `test-playwright` if you trust Go/Vitest already green).
4. Capture latency.jsonl → cold + steady min/median/max for phone-390 and desktop-1280.
5. If still multi-second: confirm poll interval in network tab / React Query; only then decide on faster poll vs other fixes (still not WebSocket by default).

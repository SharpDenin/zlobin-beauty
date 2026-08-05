# Progress

## Discovery (2026-08-01)

### Found structure

- Git repo on `main`, single commit `Initial commit`.
- Present: Go-oriented `.gitignore`, empty `frontend/`, `backend/` with JetBrains `.idea` only.
- Absent: application code, Compose, migrations, docs, CI.
- Host: Node 22 / npm 10, Docker 29; Go 1.26 installed during this session.

## Stage 1 (complete)

Vertical slice verified on real PostgreSQL:

`register → salon → master profile → service → schedule → client search → book → master confirm`

Services: identity, organizations, marketplace, booking, gateway. Frontend React/Vite. Docs + ADRs 001–005.

Local host ports: Go `8101–8104`, gateway `8090` (8080 occupied). Compose: Postgres `5433`, NATS.

## Quality pass + Stage 2 (in progress, 2026-08-01)

### Quality / production hardening

- Auth refresh single-flight; humanized API errors; session redirect.
- Adaptive shell: safe-area, bottom nav by role, mobile logout, design tokens.
- Marketplace membership check via organizations internal API (`GET /v1/internal/memberships/check`).
- Booking: timezone-aware slots, atomic status transitions, cancel/reschedule/start/complete/no-show + history.
- Server timeouts; Playwright e2e skeleton for breakpoints + Stage 1 flow.
- Audit: `docs/quality-audit.md`.

### Stage 2 implemented so far

| Area | Status |
|------|--------|
| Appointment lifecycle (cancel/reschedule/start/complete/no-show/history) | Done (booking) |
| Notifications (DB inbox) | Done (`communications`) |
| Reviews (completed visit only, one per appointment) | Done (`communications`) |
| Client card + visits + notes + formulas + consents | Done (`clients`) |
| Gateway routes for client-cards / notifications / reviews | Done |
| Frontend: appointment detail, client card, notifications, profile, reviews on master | Done |
| Playwright Stage 2 visit→review flow | Pending run |
| Visit photos / MinIO | Deferred (R5) |
| Email/SMS | Not wired (no provider settings) |

### New migrations

| Service | File |
|---------|------|
| booking | `002_stage2.sql` (status history, cancel_reason) |
| clients | `001_init.sql` |
| communications | `001_init.sql` |

### How to run

```text
powershell -File scripts/dev-local.ps1
# clients :8105, communications :8106, INTERNAL_TOKEN=dev-internal-token
cd frontend
$env:VITE_API_BASE_URL="http://localhost:8090"
npm run dev
```

### Remaining for Stage 2 criterion

- API Stage 2 smoke verified: `E2E_OK status=completed visits=1 notifications=5`.
- Playwright phone-390: Stage 1 + Stage 2 UI paths green (`npm run test:e2e -- --project=phone-390`).
- Gateway strips upstream CORS headers (fixes duplicate ACAO breaking browser login).
- Visit photos / MinIO still deferred.
- Then Stage 3 (salon staff, inventory, supplier).

## Stages 3–4

Not started.

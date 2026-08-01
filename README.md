# Zlobin Beauty

Production-oriented monorepo for a multi-role beauty platform (clients, masters, salons, suppliers, sales reps, system admins).

## Structure

- `frontend/` — React + TypeScript + Vite
- `backend/services/*` — Go microservices with owned PostgreSQL databases
- `backend/gateway/` — public API edge
- `docs/` — architecture, domain model, plan, progress, ADRs
- `deploy/` — local Postgres init and future deploy assets

## Prerequisites

- Docker / Docker Compose
- Go 1.26+ (for local unit tests)
- Node.js 22+ (frontend)

## Quick start (host Go + Compose Postgres)

Docker Hub TLS issues may block building Go service images. Verified local path:

```bash
cp .env.example .env
docker compose up -d postgres nats
# PowerShell: scripts/dev-local.ps1  (gateway http://localhost:8090)
cd frontend
# ensure VITE_API_BASE_URL=http://localhost:8090
npm install
npm run dev
```

Optional one-shot system admin (not demo data):

```bash
# with identity DB reachable and env BOOTSTRAP_ADMIN_* set
go run ./services/identity/cmd/bootstrap-admin
```

API gateway (local): `http://localhost:8090`  
Frontend: `http://localhost:5173`

When registry access works: `docker compose up -d --build` as in `Makefile`.

## Stage 1 flow

1. Register as master (checkbox on register) or login.
2. Open **Кабинет**, create salon, publish master profile, add service, set schedule.
3. Register/login as client, search by city, open master, book a slot.
4. Master opens **Записи** → confirm appointment.

## Tests

```bash
cd backend && go test ./...
cd frontend && npm test
```

## Docs

See `docs/architecture.md`, `docs/implementation-plan.md`, `docs/progress.md`.

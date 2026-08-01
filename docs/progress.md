# Progress

## Discovery (2026-08-01)

### Found structure

- Git repo on `main`, single commit `Initial commit`.
- Present: Go-oriented `.gitignore`, empty `frontend/`, `backend/` with JetBrains `.idea` only.
- Absent: application code, Compose, migrations, docs, CI.
- Host: Node 22 / npm 10, Docker 29; Go 1.26 installed during this session.

### Already implemented (before this work)

Nothing production-related.

### Technical debt / risks noted at discovery

- Greenfield platform; contracts and tenancy must be established carefully.
- Docker Hub TLS timeouts on this machine blocked multi-stage image builds for Go services.
- Port `8080` occupied by another local stack; gateway uses `8090` for host runs.
- Maps and online payments deferred until real providers exist.

## Completed in this session (Stage 1 vertical slice)

- Architecture docs: `docs/architecture.md`, `domain-model.md`, `implementation-plan.md`, `progress.md`, `docs/adr/001–005`.
- Infra: `docker-compose.yml` (Postgres on host `5433`, NATS, optional MinIO), `deploy/postgres/init-databases.sql`, `Makefile`, `.env.example`, `README.md`.
- Shared Go packages: config, logging, db+migrations, auth (Argon2id + JWT + refresh rotation), httpx, ids, apperr.
- Services with migrations and HTTP APIs:
  - `identity` — register/login/refresh/logout/me + one-shot `bootstrap-admin`
  - `organizations` — create salon org+branch, list mine, add master membership
  - `marketplace` — master profile, services, search, public master card
  - `booking` — working hours, free slots, create appointment, confirm, list mine; exclusion constraint on overlaps
  - `gateway` — reverse proxy edge
- Frontend (React/TS/Vite): auth, home, search, master booking, appointments (incl. confirm), master cabinet (salon/profile/service/schedule). Incomplete domains not in nav.
- Tests: Go auth + appointment status transitions; frontend status label vitest; frontend production build OK.
- Verified end-to-end against real PostgreSQL (host Go processes + Compose Postgres): register master → create salon → publish profile/service/schedule → register client → search → book slot → master confirms → both lists show `confirmed`.

## Migrations added

| Service | File |
|---------|------|
| identity | `backend/services/identity/migrations/001_init.sql` |
| organizations | `backend/services/organizations/migrations/001_init.sql` |
| marketplace | `backend/services/marketplace/migrations/001_init.sql` |
| booking | `backend/services/booking/migrations/001_init.sql` |

## Decisions

See ADRs 001–005 (monorepo DBs, tokens, HTTP+NATS later, appointment exclusion, payments without PSP).

Additional runtime decision: local Stage 1 verification runs Go services on the host (`8101–8104`, gateway `8090`) because pulling `golang`/`dockerfile` build images failed with Docker Hub TLS timeouts. Compose still provides Postgres/NATS.

## Remaining limits

- Stages 2–4 not started (reschedule/cancel/visit/clients/commerce/supplier/rep/reporting/admin UI).
- NATS outbox/consumers not wired yet (events reserved in architecture).
- MinIO/files not used in Stage 1 UI.
- Working hours treated as UTC-day minutes (branch timezone conversion later).
- Marketplace does not yet verify org membership on profile upsert (owner self-setup path); tighten in Stage 3 with invitations.
- Distance search and maps omitted until provider configured.
- Full Docker image build for all services pending reliable registry access.

## How to run locally (verified path)

```text
docker compose up -d postgres nats
# start Go services (see scripts/dev-local.ps1) on 8101–8104 + gateway 8090
cd frontend && set VITE_API_BASE_URL=http://localhost:8090 && npm run dev
```

## Next vertical slice

Stage 2: reschedule/cancel, start/complete visit, client card, notes/photos/formulas, reviews, notifications.

# Architecture

## Repository discovery

The repository at discovery was effectively empty:

| Path | State |
|------|--------|
| `.gitignore` | Go-oriented ignore rules |
| `backend/` | Only IntelliJ `.idea` metadata |
| `frontend/` | Empty directory |
| Application code, migrations, compose, docs | Absent |

There was a single commit (`Initial commit`) with no production application. Target structure below is adopted without rewriting existing product code.

## Goals

Production multi-tenant beauty platform for clients, masters, salon owners/admins, suppliers, sales representatives, and system administrators. All user actions go through real HTTP APIs, PostgreSQL, and migrations. No stubs, seed business data, or fake server responses.

## Target layout

```text
/
  frontend/                 # React + TypeScript + Vite
  backend/
    services/
      identity/             # accounts, sessions, roles
      organizations/        # orgs, salons, membership
      marketplace/          # masters, services, search
      booking/              # schedule, appointments
      clients/              # client cards, visits, formulas
      commerce/             # inventory, supplier/client orders
      communications/       # reviews, notifications
      reporting/            # read models, admin metrics
    gateway/                # public BFF / API edge
    shared/                 # infra-only helpers (no domain logic)
    contracts/              # OpenAPI / event schemas
  deploy/
  docs/
    adr/
  scripts/
  Makefile
  docker-compose.yml
```

## Service boundaries

| Service | Owns | Notes |
|---------|------|-------|
| `identity` | users, credentials, sessions, system roles, security audit | Short-lived access JWT + rotating refresh tokens (hashed) |
| `organizations` | organizations, branches, memberships, invitations, booking policy | Tenant boundary; other services receive org context, never join org tables |
| `marketplace` | master profiles, services, categories, portfolio, salon cards, search index | Search filters: city, price, rating, availability (via booking), distance when maps configured |
| `booking` | working hours, holds, appointments, status machine | Overlap prevented by transaction + exclusion constraint |
| `clients` | client profiles per org, visit history, notes, formulas, media refs, consents | Access gated by org/master/appointment relationship |
| `commerce` | products, stock, supplier orders, client shop orders, debts | Payment: cash on delivery / invoice / manual confirm until real PSP |
| `communications` | reviews, notification templates, outbox delivery | External SMS/email only when provider configured |
| `reporting` | projected read models from events | No heavy queries against operational DBs |
| `gateway` | authn of bearer tokens, rate limits, routing, request IDs | No business rules |

Shared Go packages may contain logging, config, DB connection helpers, HTTP middleware, auth token parse/verify, tracing, testcontainers helpers. Business rules stay inside owning services.

## Data storage

- PostgreSQL: one server in local/dev compose; separate databases (and credentials) per service.
- Migrations live under each service (`migrations/`) and run before that service starts.
- IDs: UUIDv7 (time-sortable, globally unique).
- Timestamps: UTC (`timestamptz`).
- Money: integer minor units (`amount_minor`, `currency` ISO 4217).
- Soft retention for significant records where domain requires history.
- No business seed data in migrations. System admin bootstrap is a one-shot CLI reading env vars.

## Inter-service communication

- Synchronous: HTTP JSON between gateway and services (gRPC may be added later for hot paths).
- Asynchronous: NATS JetStream with transactional outbox, idempotent consumers, retries, DLQ, event versioning, `event_id` + `correlation_id`.
- No distributed transactions across services.

## Files

Object storage compatible with S3 (MinIO locally). Metadata in the owning service DB: file id, owner, org, type, size, checksum, processing state, ACL, created_at. Private by default; temporary signed URLs; random object keys; MIME/size validation; do not trust file extensions.

## Frontend

- React, TypeScript, Vite, React Router, TanStack Query, React Hook Form, Zod.
- Feature-sliced layout: `app/`, `pages/`, `widgets/`, `features/`, `entities/`, `shared/`.
- UI never calls network directly; API clients live in domain modules.
- Incomplete features are not linked in primary navigation.
- Design tokens (CSS variables): light background, purple accent, white cards, soft borders, responsive shell (bottom nav mobile / side nav desktop).

## Security baseline

- Server-side validation; RBAC + org isolation; mass-assignment protection.
- Rate limits on auth and sensitive routes; CORS allowlist; secure headers; body/file size limits.
- Internal service ports not published externally in production compose profiles.
- No PII or tokens in logs; structured logging + OpenTelemetry + Prometheus metrics.

## Local runtime

Docker Compose provides PostgreSQL, NATS, MinIO, and all backend services. Frontend uses Vite in development against the gateway. Production images are multi-stage builds running as non-root.

## Stage 1 scope (first vertical slice)

Working path through real PostgreSQL:

1. Infra + migrations + bootstrap system admin  
2. Register / login  
3. Create organization + salon branch  
4. Master profile + services + schedule  
5. Client search → free slot → create appointment  
6. Master confirms; both sides see appointment  

Later stages follow `docs/implementation-plan.md`.

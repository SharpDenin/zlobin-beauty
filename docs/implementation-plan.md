> Исторический план срезов. Текущая архитектура: [ARCHITECTURE.md](ARCHITECTURE.md).

# Implementation plan

## Principles

- Small vertical slices: API + migration + UI + authz + tests + docs per slice.
- No unfinished items in primary navigation.
- Prefer extending owning services over new microservices for closely related flows.

## Stage 1 — Foundation and first booking path (current)

1. Compose: PostgreSQL, NATS, MinIO, service containers.
2. Shared infra libraries (config, log, HTTP, auth verify, migrate runner).
3. `identity`: register, login, refresh, logout, bootstrap-admin CLI.
4. `organizations`: create org + branch, membership for creator as owner.
5. `marketplace`: master profile, services, publish, basic search.
6. `booking`: working hours, free slots, create appointment, confirm.
7. `gateway`: route public API, JWT validation, error envelope.
8. Frontend: auth, org onboarding, master setup, client search/book, master confirm.

**Exit criteria:** clean DB → bootstrap admin → owner creates salon → master sets schedule/services → client books → master confirms; both UIs show real data.

## Stage 2 — Visit lifecycle

Reschedule/cancel, start/complete visit, client card, notes, photos, formulas, reviews, notifications.

## Stage 3 — Salon and materials

Staff invitations, org roles, shared calendar, warehouse, norms, write-offs, critical stock, demand forecast, supplier order + acceptance.

## Stage 4 — Supplier, shop, platform admin

Supplier cabinet, sales rep deliveries, client e-commerce, reporting projections, system admin tools, hardening and responsiveness audit.

## Mandatory end-to-end scenarios (tracking)

| # | Scenario | Target stage |
|---|----------|--------------|
| 1 | Owner creates salon, service, invites master | 1–3 |
| 2 | Master sets schedule | 1 |
| 3 | Client finds master and books | 1 |
| 4 | Master confirms | 1 |
| 5 | Client reschedules | 2 |
| 6 | Master starts/completes visit | 2 |
| 7 | Note, photo, formula | 2 |
| 8 | Client review | 2 |
| 9 | Material consumption on stock | 3 |
| 10–13 | Supplier order → confirm → delivery → accept | 3–4 |
| 14 | Client product order | 4 |
| 15 | Owner sees updated KPIs | 4 |

## Immediate next work after Stage 1 docs

Implement Stage 1 services and frontend until the booking confirmation path works against PostgreSQL.

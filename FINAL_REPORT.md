# FINAL_REPORT.md — Salon-X hardening reconciliation

Дата: **2026-08-15**

Продукт в UI: **Salon-X**. Внутренние Go package paths: `zlobin-beauty` (без rename).

Демо-аккаунты (пароль `Password123!` / `SEED_PASSWORD`):
`client1`–`client3`, `master1`–`master4`, `admin1@demo.local`, `supplier1`/`supplier2`, `rep1`/`rep2`.

См. также: `MANUAL_TEST.md`, `MANUAL_DEMO.md`, `README_DEPLOY.md`.

---

## Hardening summary (2026-08-15)

| Fix | Status |
|-----|--------|
| `fixed_window` capacity > 1 vs unique appointment index | **Implemented** — migration `booking/009_occurrence_capacity.sql` drops unique active-per-occurrence; marketplace CAS on `booked_count`; seed capacity=3 |
| `datetime-local` → salon/location IANA TZ | **Implemented** — `frontend/src/shared/lib/time.ts` (`datetimeLocalToIso`); used in `ServicesPage`, `AppointmentDetailPage`, planner blocks |
| Delivery as physical SoT | **Implemented** — UI commercial machine stops at `ready_for_dispatch`; physical steps via `/delivery/*`; order transitions no longer allow `in_transit`/`delivered` |
| Browser POST idempotency | **Implemented** — CORS allows `Idempotency-Key`; booking flow reaches backend; regression test in `shared/httpx` |
| KB rich demo seed | **Implemented** — seed uploads cover/inline PNG + optional WebM; 12 `doc_json` articles with product links |
| Playwright no soft-skip of core seeded flows | **Implemented** — API down → skip; API up + missing seed/login → **FAIL** |
| Production env / volumes / backup docs | **Implemented** — see `README_DEPLOY.md`, `.env.example`, `.env.production.example` |
| Shop `professional_only` audience filter | **Implemented** — client `/v1/commerce/shop/products` hides Pro Fiber; e2e green |
| Service healthchecks / bind hardening | **Implemented** — healthchecks on Go services + MinIO/NATS; internal ports on `127.0.0.1` |

---

## Requirement matrix

Правило: **Implemented** только если есть backend **и** (UI или явный API-only контракт с тестами). Только UI или только API → **Partial**.

### 1. Supplier Representative

| | |
|--|--|
| **Status** | **Implemented** |
| **Backend** | `POST/GET …/representatives`, `GET /v1/me/representative`, `GET/POST …/tasks`, `POST /v1/tasks/{id}/status`, `GET …/routes`, `POST …/routes/recommend`, `GET/POST …/rep/deliveries` |
| **Migrations** | `organizations/006_staff_reps.sql` |
| **Frontend** | `RepPage.tsx` (задачи, маршрут recommend, доставки), `SupplierTeamPage.tsx` |
| **Tests** | `e2e/salon-x.spec.ts` (rep home) |

### 2. Supplier warehouse

| | |
|--|--|
| **Status** | **Implemented** |
| **Backend** | `/v1/commerce/locations`, products, stock, forecast, movements, import |
| **Migrations** | `commerce/001_init.sql`, `007_inventory_audience.sql` |
| **Frontend** | `WarehousePage.tsx` |
| **Tests** | `e2e/salon-x.spec.ts` warehouse smoke |

### 3. Supplier / representative analytics

| | |
|--|--|
| **Status** | **Implemented** |
| **Backend** | `GET /v1/commerce/supplier/analytics` (owner/admin/rep) |
| **Migrations** | analytics store (commerce) |
| **Frontend** | `SupplierAnalyticsPage.tsx` |
| **Tests** | `e2e/salon-x.spec.ts` |

### 4. Recurring supplies

| | |
|--|--|
| **Status** | **Implemented** |
| **Backend** | `POST/GET /v1/commerce/recurring`, `…/decide`, `…/status` |
| **Migrations** | `commerce/008_recurring_supply.sql` |
| **Frontend** | `RecurringPage.tsx` — buyer create (`/cosmetics/recurring`) + supplier approve (`/supplier/recurring`) |
| **Tests** | `commerce/internal/service/recurring_test.go`; seed creates + approves |

### 5. Subscription / free / trial

| | |
|--|--|
| **Status** | **Implemented** |
| **Backend** | `GET /v1/me/subscription`, entitlements, DEV setter when `ALLOW_DEV_BILLING` |
| **Migrations** | `identity/003_subscriptions.sql` |
| **Frontend** | `ProfilePage.tsx` |
| **Tests** | `shared/entitlement/entitlement_test.go`; `e2e/salon-x.spec.ts` snapshot |

### 6. Salon team / owner permissions

| | |
|--|--|
| **Status** | **Implemented** |
| **Backend** | staff list/invite/disable, contact-policy PATCH |
| **Migrations** | memberships + `006_staff_reps.sql` |
| **Frontend** | `StaffPage.tsx` — policy, invite by `user_id`, disable |
| **Tests** | `e2e/salon-x.spec.ts` |

### 7. Planner blocks

| | |
|--|--|
| **Status** | **Implemented** |
| **Backend** | CRUD `/v1/planner/blocks` |
| **Migrations** | `booking/008_blacklist_scheme.sql` |
| **Frontend** | `CalendarPage.tsx` — list, create in salon IANA timezone, move +30 min, delete |
| **Tests** | manual / demo |

### 8. Client contact visibility

| | |
|--|--|
| **Status** | **Implemented** |
| **Backend** | org policy + clients service redaction |
| **Migrations** | `organizations/006_staff_reps.sql` |
| **Frontend** | `StaffPage.tsx` toggle; card views respect API redaction |
| **Tests** | policy UI smoke |

### 9. No-show blacklist

| | |
|--|--|
| **Status** | **Implemented** |
| **Backend** | `POST …/no-show`, auto-blacklist threshold, `GET …/blacklist`, `POST …/unblock` |
| **Migrations** | `booking/008_blacklist_scheme.sql` |
| **Frontend** | no-show on `AppointmentDetailPage`; status/count + conditional unblock on `ClientCardPage` |
| **Tests** | `e2e/salon-x.spec.ts` blacklist status contract |

### 10. Product audience

| | |
|--|--|
| **Status** | **Implemented** |
| **Backend** | `audience` + list/detail shop filter for clients |
| **Migrations** | `commerce/007_inventory_audience.sql` |
| **Frontend** | `SupplierProductEditPage.tsx` |
| **Tests** | `e2e/salon-x.spec.ts` hides Pro Fiber from client API |

### 11. Pickup flow

| | |
|--|--|
| **Status** | **Implemented** |
| **Backend** | `GET /v1/branches/pickup`; orders `destination_branch_id` |
| **Migrations** | `organizations/005_branch_pickup.sql`; commerce delivery fields |
| **Frontend** | `CosmeticsSupplierPage.tsx` branch picker |
| **Tests** | `e2e/demo-mvp.spec.ts` |

### 12. Knowledge Base (demo production-like)

| | |
|--|--|
| **Status** | **Implemented** |
| **Backend** | knowledge CRUD, favorites, filters, ranking, `product_ids`, cover, `doc_json` |
| **Migrations** | `005_knowledge_base.sql`, `010_knowledge_rich.sql`, `011_knowledge_production.sql` |
| **Frontend** | list/article, `RichDocEditor` + video node, `MediaDropzone` image/video preview, filters, favorites, product_ids field |
| **Tests** | ranking unit; e2e knowledge + favorite |

### 13. Architecture: capacity / TZ / Delivery

Covered in hardening summary above — all **Implemented**.

---

## Cross-service invariants (post-hardening)

1. **Capacity**: marketplace `booked_count < capacity` CAS; booking allows multiple active appointments per occurrence.
2. **Wall time**: occurrence/reschedule/planner create interpret local inputs in IANA TZ, not browser TZ.
3. **Orders vs Delivery**: commercial order status ≠ physical location; physical truth is `order_deliveries.status`. Completing delivery may complete the order atomically in commerce store.
4. **Audience**: client shop list excludes `professional` products.
5. **Contact policy**: clients service masks phone/email when org policy is false.
6. **Entitlements**: complete-with-scheme / Premium skip gated by subscription snapshot.

---

## Test posture

- Backend: domain delivery transitions/audience, CORS idempotency preflight, entitlement, recurring date helpers, capacity migration guard — `go test ./...` green.
- Frontend Vitest: `time.test.ts` salon TZ conversion — green.
- Playwright (`phone-390` / `tablet-768` / `desktop-1440`): `demo-mvp.spec.ts` + `salon-x.spec.ts` — **30 passed**, 24 skipped by viewport gate, **0 failed** on clean seeded stack (2026-08-15).
- Seed: Delivery SoT transit/delivered → **200**; recurring supply seeded.

---

## Deploy readiness

Verified locally: `docker compose down -v` → `up -d --build` → all services **healthy** → `docker compose --profile seed run --rm --build seed` → gateway `/healthz` OK.

See `README_DEPLOY.md`: persistent `pgdata`/`miniodata`; `.env.production.example`; backup/restore; update/rollback; internal ports bound to `127.0.0.1`; no hardcoded public localhost in production env.

---

## BLOCKERS BEFORE SERVER DEMO

_(пусто)_

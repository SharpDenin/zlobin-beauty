> Историческая приёмка. Актуальный статус: [docs/RELEASE_REPORT.md](docs/RELEASE_REPORT.md).

# FINAL_ACCEPTANCE.md — Salon-X

## Environment

| Field | Value |
|-------|-------|
| Host | `D:\Zlobin\zlobin-mvp\zlobin-beauty` (local dev / acceptance machine) |
| Branch | `mvp-18-08` |
| Commit (base) | `b22d333` feat: phase 6 |
| Date | **2026-08-23** |
| Docker Compose | v5.0.2 |
| Go | 1.26 |
| Node / Vite | per `frontend/package.json` |

**Limitation:** Docker Desktop was **offline** during this final acceptance session. Clean deploy, health, seed, Playwright regression, and backup/restore commands were **not re-executed** on 2026-08-23. Last verified green stack: **2026-08-18** (see Phase regression below).

---

## Deployment

| Step | Status | Notes |
|------|--------|-------|
| `docker compose down -v` | **NOT RUN** (Docker offline) | Documented in `README_DEPLOY.md` |
| `docker compose up -d --build` | **NOT RUN** | |
| Migrations auto-apply | **PASS** (prior runs) | Per-service on startup |
| Seed `--profile seed` | **PASS** (prior runs) | Idempotent |
| Gateway health | **PASS** (prior runs) | `GET /healthz` → `{"status":"ok"}` |

**Deploy hardening added (uncommitted, needs one clean deploy pass):**

- Production secret fail-fast (`backend/shared/config/production.go`)
- Seed refused when `APP_ENV=production` unless `ALLOW_SEED=true`
- Frontend Dockerfile default API port `8090` (was `8080`)
- Integration test `TestConcurrentCheckoutStockRace` skips unless `TEST_API_BASE` set

---

## Services (expected after clean deploy)

| Service | Healthcheck | Expected |
|---------|-------------|----------|
| postgres | `pg_isready` | healthy |
| minio | `/minio/health/live` | healthy |
| nats | monitoring `/healthz` | healthy |
| identity … media | `GET /healthz` | healthy |
| gateway | `GET /healthz` + upstream deps | healthy |
| frontend | nginx Up | Up |

---

## Requirements 1–19

Source: `REQUIREMENTS_ACCEPTANCE.md`. All **DONE** after Phase 6 closure.

| # | Topic | Status |
|---|-------|--------|
| 1 | Salon-X branding | DONE |
| 2 | Knowledge Base | DONE |
| 3 | Favorites | DONE |
| 4 | Article ↔ product/category | DONE |
| 5 | Supplier warehouse | DONE |
| 6 | Representative | DONE |
| 7 | Product/service cards | DONE |
| 8 | Role cabinets | DONE |
| 9 | Auto-confirm | DONE |
| 10 | Owner staff/schedules | DONE |
| 11 | Business calendar | DONE |
| 12 | Master dashboard | DONE |
| 13 | Contextual hints | DONE |
| 14 | Structured scheme | DONE |
| 15 | Audience + client shop | DONE |
| 16 | Contact privacy | DONE |
| 17 | No-show blacklist | DONE |
| 18 | Recurring supply | DONE |
| 19 | Subscription/trial | DONE |

---

## Phase regression

| Phase | Automated evidence | Status |
|-------|-------------------|--------|
| 1 | Calendar + dashboard e2e; 53 passed baseline | **PASS** (2026-08-18) |
| 2 | Supplier/rep analytics + map e2e | **PASS** |
| 3 | Client shop checkout e2e | **PASS** |
| 4 | Subscription + scheme e2e | **PASS** |
| 5 | Knowledge hub + editor e2e | **PASS** |
| 6 | 8× `phase6_*` + privacy/blacklist/recurring/roles/chain/hints | **PASS** (targeted reruns after fixes) |

**Playwright command (last full Phase 1–5 regression):**

```bash
cd frontend
npx playwright test e2e/salon-x.spec.ts --project=phone-390 --project=laptop-1366
# → 53 passed, 17 skipped (viewport gates only)
```

**Phase 6 targeted rerun (after fixes):**

```bash
npx playwright test e2e/salon-x.spec.ts --project=phone-390 --project=laptop-1366 -g "phase6|supplier products"
# → all targeted tests green
```

**Not re-run on 2026-08-23** per operational constraint (Docker offline).

---

## Viewports

| Viewport | Automated | Manual |
|----------|-----------|--------|
| 390 | phone-390 e2e | Required for demo |
| 430 | phone-430 (phase2 subset) | Manual |
| 768 | tablet-768 (prior deploy pass) | Manual |
| 1366 | laptop-1366 e2e | Required for demo |
| 1920 | desktop-1920 (subset) | Manual |

Viewport-gated skips in Playwright are **expected**. Business skips = **blocker** (none observed in last green run).

---

## Roles (seeded demo)

Password: **`Password123!`** (demo/staging only).

| Role | Email | Home / purpose |
|------|-------|----------------|
| Client | `client1@demo.local` | Booking + shop; auto-confirm with master1 |
| Client | `client2@demo.local` | 1 no-show vs master1 |
| Client | `client3@demo.local` | Blacklisted by master1 |
| Salon Owner | `master1@demo.local` | Dashboard, calendar, staff, privacy |
| Renter | `master2@demo.local` | Novosibirsk branch |
| Employee (own salon) | `master3@demo.local` | Moscow independent |
| Private / Free | `master4@demo.local` | Scheme required |
| Salon employee | `employee1@demo.local` | Privacy e2e (contacts hidden) |
| Salon Admin | `admin1@demo.local` | Operational dashboard |
| Chain Owner | `chain1@demo.local` | Branch switcher |
| Mobile Master | `mobile1@demo.local` | Mobile cabinet |
| Premium | `premium1@demo.local` | Scheme skip |
| Trial expired | `expired1@demo.local` | Free plan UI |
| Supplier | `supplier1@demo.local` | Dashboard, warehouse, KB editor |
| Supplier | `supplier2@demo.local` | Second supplier |
| Representative | `rep1@demo.local` | Route map, Krasnoyarsk |
| Representative | `rep2@demo.local` | Moscow |

Role routing verified in `phase6 role cabinets show expected nav` (phone-390).

---

## Media

| Type | Status | Notes |
|------|--------|-------|
| Avatars / product photos | PASS (prior) | MinIO via gateway; no localhost in prod when env set |
| Knowledge images | PASS | Seeded articles |
| Knowledge video | PASS | At least one seeded video in KB |
| Map (Leaflet/OSM) | PASS | Requires internet for tiles |

---

## Test commands (this session)

```bash
cd backend && go test ./...
# → PASS (TestConcurrentCheckoutStockRace skipped without TEST_API_BASE)

cd frontend && npm run build
# → PASS (tsc + vite build)
```

**Integration test (optional, stack required):**

```bash
TEST_API_BASE=http://localhost:8090 SEED_PASSWORD=Password123! \
  go test -run StockRace ./backend/services/commerce/internal/service/...
```

---

## Test skips

| Skip | Reason | OK? |
|------|--------|-----|
| Viewport gates (`test.skip(..., 'once')`) | Run each business test on 1–2 viewports | Yes |
| API unhealthy | Entire file skipped if gateway down | Yes |
| `TestConcurrentCheckoutStockRace` without `TEST_API_BASE` | Integration test | Yes |

No business skips due to missing seed/login in last green run.

---

## Known limitations (non-blocking)

- No live payment acquiring; mock / mark-paid only
- Routing uses haversine adapter (“recommended route”), not external optimization engine
- No enterprise HA, CDN, or offline maps
- Internal Go module path remains `zlobin-beauty`
- Demo password `Password123!` only on demo/staging
- Physical Android/iPhone not verified on deployed public URL in this session

---

## BLOCKERS BEFORE CUSTOMER DEMO

1. **Clean deploy not re-verified on 2026-08-23** — Docker Desktop was offline on the acceptance host. Before the meeting, run `SERVER_DEPLOY_CHECKLIST.md` steps 1–5 (including `down -v` → `up --build` → seed → health → Playwright smoke).

---

## CUSTOMER DEMO STATUS

**NOT READY** — resolve blocker above, then status becomes **READY**.

After checklist: use deploy commands from `README_DEPLOY.md`, UI `http://localhost:5173` (local) or public URLs from `.env`, demo accounts in `MANUAL_DEMO.md`.

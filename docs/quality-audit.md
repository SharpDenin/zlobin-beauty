> Исторический аудит Stage 1 (август 2026). Текущий статус: [RELEASE_REPORT.md](RELEASE_REPORT.md), [SECURITY.md](SECURITY.md).

# Quality audit (Stage 1)

Date: 2026-08-01. Based on code review, existing tests, and prior E2E against real PostgreSQL.

## Critical (fixed in this pass)

| ID | Area | Finding | Resolution |
|----|------|---------|------------|
| C1 | Auth | Access JWT expires in 15m; API client never refreshed mid-session | Single-flight refresh + retry in `apiRequest` |
| C2 | Auth UX | Mobile: logout only in desktop sidenav (hidden ≤767px) | Mobile topbar with logout |
| C3 | Authz | `/master` open to any authenticated user | `RequireRole` for master/salon_owner/system_admin |
| C4 | Nav | Bottom nav fixed 4 columns with 3 client links | Dynamic columns from link count |
| C5 | Layout | No safe-area insets; content under bottom nav | `env(safe-area-inset-*)` + padding |
| C6 | Marketplace | Any user can bind profile/services to any org | Membership check via organizations service |
| C7 | Booking | Slots computed in UTC wall-clock, ignoring branch timezone | Resolve branch TZ; interpret date in that zone |
| C8 | Booking | Status updates not optimistic (`WHERE status=`) | Atomic transition updates |
| C9 | Clients API | Conflicting Go ServeMux patterns | Paths `/v1/client-cards/id/...` and `/appointment/...` |

## Stage 2 verification notes

- Services `clients` (8105) and `communications` (8106) added; booking posts visits + inbox notifications on complete.
- Reviews require completed appointment and client ownership; unique per appointment.
- Visit photos / MinIO still deferred.

| ID | Area | Finding | Resolution |
|----|------|---------|------------|
| M1 | Forms | Master cabinet: Zod errors not shown | Field-level error UI |
| M2 | Forms | Login ignores `location.state.from` | Redirect after login |
| M3 | UI | Confirm errors via `alert()` | Inline error state |
| M4 | Roles | `salon_owner` vs `master` inconsistency in appointments toggle | Shared `hasMasterAccess` |
| M5 | HTTP | Missing Read/Write timeouts on servers | Timeouts on all `http.Server`s |
| M6 | Gateway | JWT_SECRET required but unused | Optional edge verify middleware for protected routes |
| M7 | Dead code | Vanilla Vite leftovers (`counter.ts`, `main.ts`, `style.css`) | Removed |
| M8 | Dup | Status labels / money format duplicated | Shared helpers |

## Remaining (accepted for later stages)

| ID | Area | Notes |
|----|------|-------|
| R1 | Gateway | Full rate-limit on auth; JSON proxy error envelope |
| R2 | Secrets | Compose still has local defaults — not for production |
| R3 | Tokens | localStorage XSS risk — httpOnly cookies later |
| R4 | NATS | Outbox/consumers deferred; Stage 2 notifications use DB-backed inbox first |
| R5 | Files | MinIO signed uploads for visit photos in Stage 2 |
| R6 | Playwright | Added for Stage 1 breakpoints; expand with Stage 2 flows |

## Responsiveness checklist (target)

| Viewport | Expected |
|----------|----------|
| 360×800 | Single column, bottom nav, full-width CTAs, no horizontal scroll |
| 390×844 | Same + safe-area |
| 768×1024 | 1–2 columns, constrained cards |
| 1024×768 | Side nav appears |
| 1280×800 / 1440×900 | Side nav + max content width |

## Pages state matrix (after fixes)

All primary Stage 1 pages expose loading, empty, and user-facing error states. Unauthorized deep links redirect. Session expiry triggers refresh or login redirect.

# Domain model

## Tenancy

An **organization** is the primary data perimeter (salon network, single salon brand, or supplier company). Users may belong to multiple organizations with different membership roles. Cross-organization access requires an explicit system permission.

## Actors and system roles

| Actor | Typical capabilities |
|-------|----------------------|
| Client | Search, book, manage own appointments, shop, review |
| Master | Schedule, appointments, client cards, warehouse of materials |
| Salon staff / owner | Org settings, staff, services, calendars, metrics |
| Supplier | Catalog, stock, B2B orders, debt, reports |
| Sales representative | Assigned deliveries, payment recording (authorized methods), day close |
| System administrator | Orgs, users, supplier verification, audit, recovery assistance |

A single account may hold multiple roles (e.g. master + salon owner).

## Core entities (Stage 1+)

### Identity

- **User** — account identity (email and/or phone), password hash, status (`active` / `blocked`), verification flags.
- **Session** — refresh token hash, family id, expires, revoked_at, user agent / IP metadata (no raw tokens stored).
- **RoleBinding** — system-level or org-scoped role assignment.
- **SecurityEvent** — login success/failure, password change, session revoke, lockouts.

### Organizations

- **Organization** — legal/display name, type (`salon` / `supplier` / `network`), status.
- **Branch** — salon location: address, geo, working hours, booking/cancellation policy.
- **Membership** — user ↔ organization with org role (`owner`, `admin`, `master`, `staff`, `rep`).
- **Invitation** — email/phone invite with token hash, role, expiry.

### Marketplace

- **MasterProfile** — public bio, specializations, experience, rating aggregates, org/branch links.
- **ServiceCategory** — hierarchical category (managed records, not migration seeds for catalog content).
- **Service** — name, duration minutes, price minor units, category, published flag.
- **MasterService** — assignment of service to master with optional price override.
- **PortfolioItem** — media reference + caption.

### Booking

- **WorkingHours** / **TimeOff** / **BlockedSlot** — availability inputs.
- **Appointment** — master, client user, service(s), branch, start/end UTC, status, price snapshot.
- Statuses and transitions (server-enforced):

```text
pending_confirmation → confirmed | cancelled_by_client | cancelled_by_master | cancelled_by_salon
confirmed → in_progress | cancelled_by_client | cancelled_by_master | cancelled_by_salon | no_show
in_progress → completed | cancelled_by_master | cancelled_by_salon
completed → (terminal)
cancelled_* / no_show → (terminal)
```

Overlap of active appointments for the same master is forbidden (exclusion constraint on tstzrange for non-cancelled statuses).

### Clients (Stage 2)

- **ClientCard**, **Visit**, **Note**, **ColorFormula**, **VisitMedia**, **Consent**.

### Commerce (Stages 3–4)

- **Product**, **StockItem**, **ConsumptionNorm**, **SupplierOrder** (+ items, statuses), **ClientOrder** (+ cart, statuses), **DebtLedger**, **PaymentRecord** (non-PSP methods).

### Communications / Reporting

- **Review**, **Notification**, **OutboxEvent**, reporting projections for KPIs.

## Money and time

- All money: `*_minor` integers + `currency` (default `RUB`).
- All calendar logic stored UTC; UI converts to branch/local timezone.

## Soft decisions (until product clarifies)

1. Default cancellation window: 12 hours before start (overridable per branch).
2. New appointments start as `pending_confirmation` unless branch policy auto-confirms.
3. Distance search is omitted from UI until a maps provider is configured.
4. Client shop and supplier flows are deferred to Stages 3–4; not shown in navigation until implemented.

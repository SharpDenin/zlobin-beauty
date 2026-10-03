> Исторический бэклог после августовской приёмки. Не заменяет [docs/RELEASE_REPORT.md](docs/RELEASE_REPORT.md).

# POST_DEMO_BACKLOG.md

Items discovered during final acceptance / deployment pass. **Do not implement before customer demo.**

Format: title · reason · priority · module

---

## Production TLS automation

- **Reason:** README documents manual cert placement; no certbot/ACME compose profile.
- **Priority:** medium
- **Module:** deploy / nginx

## Frontend bundle size / code splitting

- **Reason:** Vite build warns ~2.1 MB JS chunk; acceptable for demo, not for long-term mobile.
- **Priority:** low
- **Module:** frontend

## Dedicated demo env profile

- **Reason:** `APP_ENV=demo` could unify seed + dev billing + demo controls instead of mixing flags.
- **Priority:** low
- **Module:** config

## OSRM / external routing provider

- **Reason:** Haversine is documented as heuristic; real route optimization deferred.
- **Priority:** medium
- **Module:** routing / representative

## Live payment acquiring

- **Reason:** Checkout uses mock payment; agreed MVP scope.
- **Priority:** high (post-MVP product)
- **Module:** commerce

## Elasticsearch / advanced KB search

- **Reason:** PostgreSQL FTS sufficient for MVP.
- **Priority:** low
- **Module:** knowledge

## Physical device QA matrix

- **Reason:** Final pass used Chrome viewports only; no physical iPhone/Android on deployed URL.
- **Priority:** medium
- **Module:** QA

## CDN for MinIO public media

- **Reason:** Media served via gateway/MinIO directly.
- **Priority:** low
- **Module:** media / deploy

## Automated migration rollback

- **Reason:** Forward-only migrations; rollback = restore from backup (documented).
- **Priority:** low
- **Module:** deploy

## Cross-browser matrix (Firefox/WebKit)

- **Reason:** Playwright smoke Chromium-only; acceptable for demo.
- **Priority:** low
- **Module:** QA

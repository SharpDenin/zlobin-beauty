> Актуальные чеклисты: [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

# SERVER_DEPLOY_CHECKLIST.md

Operational checklist for demo server or production. Real project commands.

## Server requirements (demo/staging minimum)

| Resource | Minimum |
|----------|---------|
| OS | Linux (Ubuntu 22.04+ recommended) or Windows Server with Docker |
| Docker Engine | 24+ |
| Docker Compose | v2 |
| CPU | 2 vCPU |
| RAM | 4 GB (8 GB comfortable) |
| Disk | 20 GB+ free (`pgdata`, `miniodata`) |
| Public ports | **80**, **443** (via reverse proxy) |
| Internal only | 5433, 9000, 9001, 4222 — bind `127.0.0.1` |

---

## Before deploy

- [ ] Docker + Compose installed
- [ ] Domain / DNS pointed to server (if public demo)
- [ ] Firewall: open 80/443 only; **not** Postgres/MinIO/NATS to internet
- [ ] `cp .env.production.example .env` and replace all `REPLACE_ME_*`
- [ ] Generate secrets: `openssl rand -hex 32` for JWT and INTERNAL_TOKEN
- [ ] Set public `VITE_API_BASE_URL`, `PUBLIC_APP_URL`, `CORS_ORIGINS`
- [ ] `APP_ENV=production`, `ALLOW_DEV_BILLING=false`
- [ ] For demo seed on staging: `ALLOW_SEED=true` + `SEED_PASSWORD` (not on real production)

```bash
grep -E 'REPLACE_ME|localhost|minioadmin|dev-change-me|Password123|ALLOW_DEV_BILLING=true|APP_ENV=development' .env || echo "env looks production-ready"
```

---

## 1. First deploy (wipe volumes)

**Only for first deploy or intentional demo reset:**

```bash
docker compose down -v    # DESTROYS pgdata + miniodata
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:8090/healthz
```

Expect: Postgres, MinIO, NATS, all Go services, gateway **healthy**; frontend Up.

---

## 2. Demo seed (staging/demo only)

```bash
# .env must have ALLOW_SEED=true if APP_ENV=production
docker compose --profile seed run --rm --build seed
```

Password for demo users: value of `SEED_PASSWORD` (local default `Password123!`).

---

## 3. Reverse proxy / TLS

- `https://app.example.com` → `127.0.0.1:5173` (frontend SPA)
- `https://api.example.com` → `127.0.0.1:8090` (gateway)
- SPA fallback: `try_files … /index.html` (see `frontend/nginx.conf`)
- API proxy: `client_max_body_size 64m` (matches `UPLOAD_MAX_BYTES`)
- Forward `X-Forwarded-Proto`, `X-Forwarded-Host`

After URL change:

```bash
docker compose up -d --build frontend gateway
```

Verify bake:

```bash
docker compose exec -T frontend sh -c 'grep -oE "https?://[a-zA-Z0-9.:_-]+" /usr/share/nginx/html/assets/*.js | sort -u'
```

---

## 4. Backup (after first successful start)

```bash
mkdir -p /var/backups/salon-x
docker compose exec -T postgres pg_dumpall -U postgres > /var/backups/salon-x/backup-$(date +%F).sql
# MinIO: snapshot volume miniodata or mc mirror from 127.0.0.1:9000
```

---

## 5. Acceptance smoke

```bash
curl -fsS http://127.0.0.1:8090/healthz
cd frontend
npx playwright test e2e/demo-mvp.spec.ts e2e/salon-x.spec.ts \
  --project=phone-390 --project=laptop-1366 --workers=1
```

Manual: `MANUAL_DEMO.md` (15–20 min).

Login smoke: `master1`, `client1`, `supplier1`, `rep1` @ demo password.

---

## 6. Normal update (NO volume wipe)

```bash
git pull
docker compose up -d --build
curl -fsS http://127.0.0.1:8090/healthz
# NEVER: docker compose down -v
```

Migrations apply forward on service start. No automatic schema rollback — restore from backup if needed.

---

## 7. Migration failure

1. Stop affected service: `docker compose stop commerce` (example)
2. Read logs: `docker compose logs commerce`
3. Fix SQL / deploy fix, redeploy
4. If DB inconsistent: restore from `pg_dumpall` backup (see step 8)

---

## 8. Restore

```bash
docker compose up -d postgres
# wait healthy
docker compose exec -T postgres psql -U postgres < /var/backups/salon-x/backup-YYYY-MM-DD.sql
# restore miniodata volume
docker compose up -d --build
```

---

## 9. Demo reset (destroys data)

```bash
docker compose down -v
docker compose up -d --build
docker compose --profile seed run --rm --build seed
```

---

## Forbidden

- Commit `.env` with real secrets
- `down -v` on production update
- Seed on production without explicit `ALLOW_SEED=true`
- Expose Postgres/MinIO/NATS ports publicly
- Leave `JWT_SECRET=dev-change-me` with `APP_ENV=production`

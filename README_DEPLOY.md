# README_DEPLOY.md — Salon-X на сервере

Развёртывание через Docker Compose. SPA (nginx) + API gateway + микросервисы + PostgreSQL + MinIO + NATS.

## Требования

- Docker Engine 24+ / Compose v2
- 2 vCPU, 4 GB RAM минимум (8 GB комфортно)
- 20+ GB диск (тома `pgdata`, `miniodata`)
- Публичные порты compose: `5173` (UI), `8090` (API) — на сервере закрыть firewall и отдавать через reverse proxy на 80/443
- Postgres / MinIO / NATS публикуются только на `INTERNAL_BIND_HOST` (default `127.0.0.1`)

## Подготовка secrets (обязательно на сервере)

```bash
git clone <repo-url> salon-x && cd salon-x
cp .env.production.example .env
```

В `.env` **замените каждый** `REPLACE_ME_*` до первого `up`. Не используйте `.env.example` на сервере — там local-dev defaults.

| Переменная | Правило |
|------------|---------|
| `JWT_SECRET` | ≥32 случайных символа (`openssl rand -hex 32`) |
| `INTERNAL_TOKEN` | отдельный случайный токен S2S (`openssl rand -hex 32`) |
| `POSTGRES_PASSWORD` | случайный пароль Postgres **superuser** (`postgres`) |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | не `minioadmin` |
| `VITE_API_BASE_URL` | **публичный** URL API (не `localhost`) |
| `PUBLIC_APP_URL` | публичный URL SPA |
| `CORS_ORIGINS` | origin SPA через запятую (обычно `https://app.example.com`) |
| `INTERNAL_BIND_HOST` | оставить `127.0.0.1` |
| `APP_ENV` | `production` |
| `ALLOW_DEV_BILLING` | `false` |
| `ALLOW_SEED` | `false` (set `true` only on intentional demo/staging host) |
| `SEED_PASSWORD` | только если запускаете demo seed; иначе не нужен |

Проверка перед стартом:

```bash
# не должно печатать совпадений после замены secrets
grep -E 'REPLACE_ME|localhost|minioadmin|dev-change-me|Password123|ALLOW_DEV_BILLING=true|APP_ENV=development' .env || true
```

Compose defaults с `localhost` / `minioadmin` / `dev-change-me-*` — **только fallback без `.env`**. При `APP_ENV=production` сервисы **fail-fast** на слабых secrets (JWT, INTERNAL_TOKEN, MinIO, Postgres). Frontend **bake-ит** `VITE_API_BASE_URL` на `docker build` (compose `args` перекрывает `ARG` в `frontend/Dockerfile`); после смены URL нужен rebuild frontend.

Примечание MVP: пароли application DB roles (`identity`, `booking`, …) заданы в `deploy/postgres/init-databases.sql` и `DATABASE_URL` compose. Env управляет superuser (`POSTGRES_PASSWORD`) и MinIO root.

Не коммитьте реальный `.env`.

## Чистый старт (первый deploy / полный wipe)

```bash
docker compose down -v          # УДАЛИТ volumes pgdata + miniodata
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:8090/healthz
# demo-данные только если нужен server demo:
docker compose --profile seed run --rm --build seed
```

Миграции применяются автоматически при старте каждого сервиса из `backend/services/*/migrations`.

### Что удаляет `docker compose down -v`

| Volume | Содержимое |
|--------|------------|
| `zlobin-beauty_pgdata` (name: `pgdata`) | все service DBs |
| `zlobin-beauty_miniodata` (name: `miniodata`) | медиа (обложки KB, фото, video) |

`down` **без** `-v` сохраняет оба тома.  
**`down -v` нельзя использовать для обычного production update** — только первый deploy, disaster wipe или локальный reset.

### Healthchecks

| Компонент | Проверка |
|-----------|----------|
| Postgres | `pg_isready` |
| MinIO | `/minio/health/live` |
| NATS | monitoring `/healthz` |
| Все Go services + Gateway | `GET /healthz`; gateway ждёт `service_healthy` upstream |
| UI | `http://127.0.0.1:5173` (или публичный URL) |

Логи: `docker compose logs -f gateway frontend postgres`

## Persistent volumes

| Volume | Данные |
|--------|--------|
| `pgdata` | identity / organizations / marketplace / booking / clients / commerce / communications / media (+ reporting) |
| `miniodata` | MinIO bucket `zlobin-media` |

## Backup

Postgres (нужен `POSTGRES_PASSWORD` из `.env`):

```bash
docker compose exec -T postgres pg_dumpall -U postgres > backup-$(date +%F).sql
```

MinIO: скопируйте Docker volume `miniodata` или `mc mirror` из контейнера/endpoint `127.0.0.1:9000`.

## Restore

На пустой стек (или после осознанного `down -v` + `up -d`):

```bash
docker compose up -d postgres
# дождаться healthy
docker compose exec -T postgres psql -U postgres < backup-YYYY-MM-DD.sql
# восстановить miniodata до старта media
docker compose up -d --build
```

## Update (обычный production update)

```bash
git pull
# при смене VITE_API_BASE_URL / CORS — правьте .env
docker compose up -d --build
# НЕ делайте: docker compose down -v
# seed только если нужны demo-данные заново (идемпотентен)
```

Миграции только **вперёд**. Schema rollback = restore из backup.

## Rollback

1. Checkout предыдущего git tag/commit
2. `docker compose up -d --build` (**без** `-v`)
3. Если данные несовместимы — restore SQL dump + MinIO volume

## Reverse proxy / TLS

Compose отдаёт HTTP. TLS на nginx/caddy/traefik:

- `https://app.example.com` → `127.0.0.1:5173` (frontend)
- `https://api.example.com` → `127.0.0.1:8090` (gateway)

Нужны `X-Forwarded-*`, `client_max_body_size 64m` на **API** proxy (upload media/video идёт через gateway, не через SPA nginx).

В `.env` перед rebuild:

```bash
VITE_API_BASE_URL=https://api.example.com
PUBLIC_APP_URL=https://app.example.com
CORS_ORIGINS=https://app.example.com
```

Gateway — единственный browser CORS boundary; `CORS_ORIGINS` должен совпадать с origin SPA.

## Hardcoded localhost check

Перед серверным демо в **runtime** `.env` / bake args **нет** `localhost` для:

- `VITE_API_BASE_URL`
- `PUBLIC_APP_URL`
- `CORS_ORIGINS`

Поиск `localhost` в compose defaults / source fallbacks — нормален для local-dev; сервер обязан переопределять через `.env`.

После build frontend:

```bash
docker compose exec -T frontend sh -c 'grep -oE "https?://[a-zA-Z0-9.:_-]+" /usr/share/nginx/html/assets/*.js | sort -u'
# ожидается публичный api host, не localhost
```

## Acceptance после clean deploy

```bash
curl -fsS http://127.0.0.1:8090/healthz
docker compose --profile seed run --rm --build seed
cd frontend
npx playwright test e2e/demo-mvp.spec.ts e2e/salon-x.spec.ts --project=phone-390 --project=tablet-768 --project=desktop-1440
```

См. также `MANUAL_TEST.md`, `SERVER_DEPLOY_CHECKLIST.md`.

## Demo seed accounts

Пароль: `SEED_PASSWORD` (local default `Password123!`).

- Clients: `client1@demo.local` …
- Masters: `master1@demo.local` …
- Salon admin: `admin1@demo.local`
- Supplier: `supplier1@demo.local`
- Representatives: `rep1@demo.local`, `rep2@demo.local`

На production seed обычно не запускают (кроме явного server demo).

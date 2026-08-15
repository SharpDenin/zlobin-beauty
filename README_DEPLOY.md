# README_DEPLOY.md — Salon-X на сервере

Развёртывание через Docker Compose. SPA (nginx) + API gateway + микросервисы + PostgreSQL + MinIO.

## Требования

- Docker Engine 24+ / Compose v2
- 2 vCPU, 4 GB RAM минимум (8 GB комфортно)
- 20+ GB диск (тома `pgdata`, `miniodata`)
- Порты: `5173` (UI), `8090` (API) — или reverse proxy на 80/443

## Подготовка secrets (обязательно на сервере)

```bash
git clone <repo-url> salon-x && cd salon-x
cp .env.production.example .env
```

В `.env` **замените** defaults:

| Переменная | Правило |
|------------|---------|
| `JWT_SECRET` | ≥32 случайных символа (`openssl rand -hex 32`) |
| `INTERNAL_TOKEN` | отдельный случайный токен S2S |
| `VITE_API_BASE_URL` | **публичный** URL API (не `localhost`) |
| `PUBLIC_APP_URL` | публичный URL SPA |
| `CORS_ORIGINS` | origins SPA через запятую |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | не `minioadmin` в prod |
| `POSTGRES_PASSWORD` | случайный пароль Postgres superuser |
| `SEED_PASSWORD` | пароль demo-аккаунтов (или отключите seed на prod) |
| `APP_ENV` | `production` |
| `ALLOW_DEV_BILLING` | `false` на сервере |

Compose defaults с `localhost` — **только для локальной разработки**. Frontend **bake-ит** `VITE_API_BASE_URL` на этапе `docker build`; после смены URL нужен rebuild frontend.
Postgres, MinIO и NATS по умолчанию публикуются только на `127.0.0.1` через `INTERNAL_BIND_HOST`; не выставляйте их наружу без firewall.

Не коммитьте реальный `.env`.

## Чистый старт

```bash
docker compose down -v          # удалит volumes Postgres/MinIO
docker compose up -d --build
# дождаться healthy gateway:
docker compose ps
curl -fsS http://127.0.0.1:8090/healthz
docker compose --profile seed run --rm --build seed
```

Миграции применяются автоматически при старте каждого сервиса из `backend/services/*/migrations`.

### Healthchecks

| Компонент | Проверка |
|-----------|----------|
| Postgres | compose `healthcheck` (`pg_isready`) |
| Все Go services + Gateway | `GET /healthz`; gateway ждёт `service_healthy` всех upstream |
| UI | `http://<host>:5173` |

Логи: `docker compose logs -f gateway frontend postgres`

## Persistent volumes

| Volume | Данные |
|--------|--------|
| `pgdata` | все service DBs в одном Postgres |
| `miniodata` | медиа (обложки KB, фото товаров, video) |

`down` без `-v` сохраняет данные. `down -v` — полный wipe.

## Backup

Postgres:

```bash
docker compose exec -T postgres pg_dumpall -U postgres > backup-$(date +%F).sql
```

MinIO: скопируйте том `miniodata` или используйте `mc mirror`.

## Restore

На пустой стек (или после `down -v` + `up -d`):

```bash
docker compose up -d postgres
# дождаться healthy
docker compose exec -T postgres psql -U postgres < backup-YYYY-MM-DD.sql
docker compose up -d --build
```

Медиа: восстановите `miniodata` до старта `media`/frontend.

## Update

```bash
git pull
# при смене VITE_API_BASE_URL / CORS — правьте .env
docker compose up -d --build
# seed только если нужны demo-данные заново (идемпотентен по заголовкам)
```

Миграции только **вперёд**. Schema rollback = restore из backup.

## Rollback

1. Checkout предыдущего git tag/commit
2. `docker compose up -d --build`
3. Если данные несовместимы — restore SQL dump + MinIO volume

## Reverse proxy / TLS

Compose отдаёт HTTP. TLS на nginx/caddy/traefik:

- `https://app.example.com` → frontend `:5173`
- `https://api.example.com` → gateway `:8090`

Нужны `X-Forwarded-*`, `client_max_body_size 64m` для media/video.

Frontend build: `VITE_API_BASE_URL=https://api.example.com`.

## Hardcoded localhost check

Перед серверным демо убедитесь, что в **runtime** `.env` / bake args **нет** `localhost` для:

- `VITE_API_BASE_URL`
- `PUBLIC_APP_URL`
- `CORS_ORIGINS` (должен совпадать с публичным SPA origin)

Поиск в репо (`localhost` в compose defaults) — нормален для local-dev; сервер обязан переопределять.

## Demo seed accounts

Пароль: `SEED_PASSWORD` (default `Password123!`).

- Clients: `client1@demo.local` …
- Masters: `master1@demo.local` …
- Salon admin: `admin1@demo.local`
- Supplier: `supplier1@demo.local`
- Representatives: `rep1@demo.local`, `rep2@demo.local`

На production demo seed обычно не запускают.

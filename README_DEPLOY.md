# README_DEPLOY.md — Salon-X на сервере

Развёртывание через Docker Compose. Приложение: SPA (nginx) + API gateway + микросервисы + PostgreSQL + MinIO.

## Требования к серверу

- Docker Engine 24+ и Docker Compose v2
- 2 vCPU, 4 GB RAM минимум (8 GB комфортно)
- 20 GB диск (тома Postgres и MinIO)
- Открытые порты: `80`/`443` (если ставите reverse proxy), либо `5173` (UI) и `8090` (API) как в compose

## Подготовка

```bash
git clone <repo-url> salon-x && cd salon-x
cp .env.example .env
# отредактируйте .env: JWT_SECRET, INTERNAL_TOKEN, публичные URL, CORS
```

Не коммитьте реальный `.env`.

## Переменные

См. `.env.example`:

| Переменная | Назначение |
|------------|------------|
| `JWT_SECRET` | Подпись JWT, ≥32 символа |
| `INTERNAL_TOKEN` | S2S вызовы |
| `VITE_API_BASE_URL` | Публичный URL API для браузера (bake в frontend image) |
| `PUBLIC_APP_URL` | Публичный URL SPA |
| `CORS_ORIGINS` | Разрешённые origin, через запятую |
| `SEED_PASSWORD` | Пароль demo-аккаунтов |
| `ROUTING_PROVIDER` | `haversine` (по умолчанию) или `osrm` |
| `OSRM_BASE_URL` | Если выбран OSRM |
| `ALLOW_DEV_BILLING` | `true` для DEV смены trial/premium |
| `APP_ENV` | `development` / `production` |

На сервере `VITE_API_BASE_URL` должен быть **публичным** URL API (не `localhost`), иначе браузеры с телефона не достучатся до API.

## Старт

```bash
docker compose down -v   # чистый старт (удалит данные)
docker compose up -d --build
docker compose --profile seed run --rm seed
```

Health:

- API: `GET http://<host>:8090/healthz`
- UI: `http://<host>:5173`

Логи: `docker compose logs -f gateway frontend postgres`

Перезапуск: `docker compose restart`

Обновление:

```bash
git pull
docker compose up -d --build
```

Миграции применяются при старте сервисов из `backend/services/*/migrations`.

## Reverse proxy / TLS

Compose отдаёт HTTP. TLS ставьте на nginx/caddy/traefik перед контейнерами.

Рекомендуемая схема:

- `https://app.example.com` → frontend `:5173`
- `https://api.example.com` → gateway `:8090`

Нужны заголовки:

- `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`
- WebSocket (если понадобится): `Upgrade`, `Connection`
- `client_max_body_size 64m` для медиа

Frontend собирается с `VITE_API_BASE_URL=https://api.example.com`.

## Бэкап / restore Postgres

```bash
docker compose exec -T postgres pg_dumpall -U postgres > backup.sql
# restore на пустой том:
docker compose exec -T postgres psql -U postgres < backup.sql
```

MinIO: том `miniodata`.

## Rollback

- Код: предыдущий git tag + `docker compose up -d --build`
- Данные: restore dump. SQL-миграции **вперёд**; отдельного down-скрипта нет — откатывайте из бэкапа.

## Seed аккаунты

Пароль: `SEED_PASSWORD` (по умолчанию `Password123!`).

- Clients: `client1@demo.local` …
- Masters: `master1@demo.local` …
- Salon admin: `admin1@demo.local`
- Supplier: `supplier1@demo.local`
- Representatives: `rep1@demo.local`, `rep2@demo.local`

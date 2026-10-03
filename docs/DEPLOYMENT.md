# Deployment

Пошаговый выкат текущим Docker Compose. Нет отдельного Kubernetes-манифеста в репозитории.

## 1. Prerequisites

- Docker Engine + Compose
- Домен и TLS (терминация на nginx/Caddy/балансировщике перед контейнерами)
- Go **1.26.6+** на машинах, где собирают backend-образы из исходников
- Node 20+ только если собираете frontend вне Docker

## 2. Environment

```bash
cp .env.production.example .env
# заменить все REPLACE_ME
```

Обязательно:

- `APP_ENV=production`
- новые `JWT_SECRET`, `INTERNAL_TOKEN`, `POSTGRES_PASSWORD`, MinIO
- `CORS_ORIGINS=https://app.example.com`
- `PUBLIC_APP_URL=https://app.example.com`
- `VITE_API_BASE_URL=` (пусто) если SPA и API на одном origin через nginx frontend
- `ALLOW_DEV_BILLING=false`
- `ALLOW_SEED=false` на реальном бою

Не публиковать Postgres/NATS/MinIO в интернет. В compose внутренние порты по умолчанию на `127.0.0.1`.

## 3. Database

Postgres 16, init: `deploy/postgres/init-databases.sql` (базы по сервисам). Том `pgdata`.

## 4. Storage

MinIO, том `miniodata`. Сменить root-учётки. Бакет создаёт media-сервис при старте.

## 5–7. Backend, gateway, frontend

```bash
docker compose up -d --build
```

Сервисы слушают `:8080` внутри сети. Gateway публикуется как **8090**. Frontend-контейнер — nginx: статика + `/v1/` на gateway.

Миграции — при старте каждого сервиса из смонтированных `migrations/`.

## 8. Seed

Только демо-стенд:

```bash
# ALLOW_SEED=true только на этом стенде
docker compose --profile seed run --rm seed
```

На бою с живыми клиентами seed не запускать.

## 9. HTTPS

Снаружи только HTTPS. HTTP — редирект. Сертификат на reverse proxy хоста.

## 10. CORS

Список точных origin приложения. Не `*`. Если SPA same-origin, CORS почти не нужен для XHR, но cookie-less Bearer всё равно требует правильного API origin.

## 11. Health

```bash
curl -fsS https://app.example.com/healthz   # если проксируете health
curl -fsS http://127.0.0.1:8090/healthz     # с хоста
```

Сервисы имеют `/healthz` на внутреннем 8080.

## 12. Verification

- Логин владельца / клиента / поставщика
- Создание записи
- Загрузка фото в портфолио
- Календарь открывается
- В бандле SPA нет адреса dev-API (`localhost` / `127.0.0.1` в `VITE_API_BASE_URL` ломает `vite build`)
- `npm audit --omit=dev` на собранных зависимостях frontend = 0

## Production preflight

- [ ] `APP_ENV=production`
- [ ] Секреты заменены, не из `.env.example`
- [ ] CORS явный
- [ ] HTTPS
- [ ] Базы созданы, миграции прошли
- [ ] MinIO с боевыми учётками
- [ ] Стратегия данных: пустой бой или отдельный demo-стенд
- [ ] `docker compose up` / сборка успешны
- [ ] Smoke: health, login, запись

Подробный чеклист релиза: [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

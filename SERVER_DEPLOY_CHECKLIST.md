# SERVER_DEPLOY_CHECKLIST.md

Команды для сервера **по порядку**. Не используйте `docker compose down -v` после первого успешного старта с данными.

## 0. Один раз: secrets

```bash
cd /path/to/salon-x
cp .env.production.example .env
# отредактируйте .env: замените все REPLACE_ME_*
# VITE_API_BASE_URL / PUBLIC_APP_URL / CORS_ORIGINS = публичные https URL
# ALLOW_DEV_BILLING=false, APP_ENV=production
# INTERNAL_BIND_HOST=127.0.0.1

grep -E 'REPLACE_ME|localhost|minioadmin|dev-change-me|Password123|ALLOW_DEV_BILLING=true|APP_ENV=development' .env || echo "env looks production-ready"
```

## 1. Первый deploy (wipe volumes)

```bash
docker compose down -v
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:8090/healthz
```

Ожидание: все Go/Postgres/MinIO/NATS/gateway **healthy**, frontend Up, `{"status":"ok"}`.

## 2. (Опционально) Demo seed

Только для server demo:

```bash
docker compose --profile seed run --rm --build seed
```

## 3. Reverse proxy / TLS

Настроить proxy:

- `https://app…` → `127.0.0.1:5173`
- `https://api…` → `127.0.0.1:8090`
- `client_max_body_size 64m` на API
- firewall: наружу только 80/443 (не 5433/9000/9001/4222)

После смены публичных URL в `.env`:

```bash
docker compose up -d --build frontend gateway
# при смене VITE_API_BASE_URL обязателен rebuild frontend
```

Проверка bake:

```bash
docker compose exec -T frontend sh -c 'grep -oE "https?://[a-zA-Z0-9.:_-]+" /usr/share/nginx/html/assets/*.js | sort -u'
```

## 4. Backup (сразу после старта)

```bash
mkdir -p /var/backups/salon-x
docker compose exec -T postgres pg_dumpall -U postgres > /var/backups/salon-x/backup-$(date +%F).sql
docker volume ls | grep zlobin-beauty
# сохраните также volume miniodata (snapshot / mc mirror)
```

## 5. Acceptance (с машины, где доступны UI+API)

Локально к серверу через туннель/VPN или на самом сервере после seed:

```bash
cd frontend
PLAYWRIGHT_BASE_URL=https://app.example.com \
VITE_API_BASE_URL=https://api.example.com \
npx playwright test e2e/demo-mvp.spec.ts e2e/salon-x.spec.ts \
  --project=phone-390 --project=tablet-768 --project=desktop-1440
```

Ручной минимум: `MANUAL_TEST.md` T1–T9 под ролями `client1` / `master1` / `supplier1` / `rep1`.

## 6. Обычный update (без wipe)

```bash
git pull
# править .env только если изменились URL/secrets
docker compose up -d --build
curl -fsS http://127.0.0.1:8090/healthz
# НЕ запускать: docker compose down -v
```

## 7. Restore (если нужно)

```bash
docker compose up -d postgres
# дождаться healthy
docker compose exec -T postgres psql -U postgres < /var/backups/salon-x/backup-YYYY-MM-DD.sql
# восстановить miniodata
docker compose up -d --build
```

## Запреты

- Не коммитить `.env`
- Не оставлять `REPLACE_ME` / `localhost` в production `.env`
- Не открывать Postgres/MinIO/NATS в интернет
- Не делать `down -v` для update — это полный wipe `pgdata` + `miniodata`

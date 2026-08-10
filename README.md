# Zlobin Beauty

Адаптивное веб-приложение beauty-платформы (MVP): клиенты ищут мастеров (по умолчанию Красноярск, опционально другие города) и записываются в режиме **flexible** или **fixed_window**; мастера ведут услуги, расписание, клиентов и B2B-заказы косметики с **самовывозом в филиал** и **оплатой (mock / mark-paid)**; поставщики управляют каталогом, доставкой и **rich** базой знаний.

## Стек

| Слой | Технологии |
|------|------------|
| Frontend | React 19, TypeScript, Vite, React Router, TanStack Query |
| Backend | Go 1.26, stdlib `net/http`, pgx |
| DB | PostgreSQL 16 (отдельная БД на сервис) |
| Infra | Docker Compose, NATS (заготовка), MinIO (медиа) |

## Архитектура (верхний уровень)

```text
browser → frontend (:5173)
       → gateway (:8090)
            → identity / organizations / marketplace / booking
            → clients / commerce / communications / media
            → postgres (per-service DBs)
```

Микросервисы владеют своими данными; gateway — HTTP edge без бизнес-логики.

## Быстрый старт (Docker)

### Требования

- Docker Desktop / Docker Engine + Docker Compose
- Свободные порты: **5173** (UI), **8090** (API), **5433** (Postgres), 9000/9001 (MinIO)

> На этой машине порт `8080` часто занят другими контейнерами, поэтому API публикуется как **8090→8080**.

### Команды

```bash
git clone <repo-url>
cd zlobin-beauty
cp .env.example .env
docker compose up -d --build
docker compose --profile seed run --rm seed
```

PowerShell:

```powershell
cd zlobin-beauty
Copy-Item .env.example .env
docker compose up -d --build
.\scripts\seed.ps1
```

Откройте:

- Frontend: http://localhost:5173
- API gateway: http://localhost:8090
- Health: http://localhost:8090/healthz

Swagger / OpenAPI UI в текущем MVP **нет**.

### Переменные окружения (`.env`)

| Переменная | Назначение | Пример |
|------------|------------|--------|
| `JWT_SECRET` | Подпись access JWT | `dev-change-me-in-production-32chars` |
| `INTERNAL_TOKEN` | S2S вызовы между сервисами | `dev-internal-token` |
| `VITE_API_BASE_URL` | URL API для браузера (bake в frontend image) | `http://localhost:8090` |
| `SEED_PASSWORD` | Пароль demo-аккаунтов | `Password123!` |
| `BOOTSTRAP_ADMIN_*` | Опциональный system admin (`--profile bootstrap`) | см. `.env.example` |

### PostgreSQL (из compose)

| Параметр | Значение |
|----------|----------|
| Host | `localhost` (с хоста) / `postgres` (из сети Docker) |
| Port | `5433` → `5432` |
| Superuser | `postgres` / `postgres` |
| Service DBs | `identity`, `organizations`, `marketplace`, `booking`, `clients`, `commerce`, `communications`, `media` (user и пароль = имя БД) |

Миграции применяются **при старте каждого сервиса** из `backend/services/*/migrations`.

### Seed

Seed ходит в **gateway `:8090`** и создаёт multi-city демо (Красноярск / Новосибирск / Москва), flexible-услуги, fixed_window МК у Анны, товары, заказы и статьи KB.

```bash
docker compose --profile seed run --rm seed
# или
./scripts/seed.ps1
# локально Go:
cd backend && GATEWAY_URL=http://localhost:8090 go run ./cmd/seed
```

Каталог косметики для мастера — карточки `GET /v1/suppliers` (UUID вводить не нужно). Checkout: филиал получения (`pickup`) + способ оплаты (онлайн-эквайринг не подключён).

### Логи / перезапуск / сброс

```bash
docker compose logs -f gateway
docker compose restart
docker compose down
# полный сброс БД и томов:
docker compose down -v
docker compose up -d --build
docker compose --profile seed run --rm seed
```

## Demo аккаунты

Пароль для всех: **`Password123!`**

| Role / тип | Login |
|------------|-------|
| Client | `client1@demo.local`, `client2@demo.local` |
| Master (owner) | `master1@demo.local` |
| Master (renter) | `master2@demo.local` |
| Master (employee) | `master3@demo.local` |
| Master (independent) | `master4@demo.local` |
| Supplier | `supplier1@demo.local`, `supplier2@demo.local` |

Сценарий показа заказчику: см. **`MANUAL_DEMO.md`**.  
Подробный отчёт итераций: **`FINAL_REPORT.md`**.

## MVP роли и разделы UI

- **Client:** главная, поиск (город + «другие города»), записи (flexible / fixed occurrence), профиль  
- **Master:** записи, календарь, услуги/occurrences, клиенты, косметика (pickup + payment), база знаний, кабинет, профиль  
- **Supplier:** товары/заказы (доставка + mark-paid), база знаний (rich editor), профиль  

Скрыты из навигации (код/API сохранены): магазин клиента, склад, отчёты салона, доставки rep, admin-справочники.

### Ключевые понятия

| Понятие | Смысл в MVP |
|---------|-------------|
| `flexible` | Свободные слоты по working hours − busy |
| `fixed_window` | Запись на заранее объявленный `service_occurrence` |
| Pickup branch | Филиал салона с `pickup_enabled` как точка получения B2B-заказа |
| Payment mock | Выбор метода + ручной `mark-paid` у поставщика (без PSP) |

## Локальная разработка (без полного Docker app)

```bash
docker compose up -d postgres nats minio
# поднять Go-сервисы (см. scripts/dev-local.ps1) → gateway :8090
cd frontend
# VITE_API_BASE_URL=http://localhost:8090
npm install
npm run dev
```

## Основные команды

```bash
# Backend
cd backend
go test ./...
go vet ./...
go build ./...

# Frontend
cd frontend
npm test
npm run build

# Docker
docker compose config
docker compose up -d --build
```

## Документация

- `FINAL_REPORT.md` — production readiness / scheduling / commerce / gaps (2026-08-10)
- `MANUAL_DEMO.md` — 12–15 мин сценарий показа заказчику
- `MANUAL_TEST.md` — детальные acceptance-сценарии
- `docs/` — историческая архитектура и ADRs (часть scope шире текущего MVP)

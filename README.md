# Salon X

Приложение для салонов красоты, частных мастеров, клиентов и поставщиков косметики. Записи, расписание, портфолио, переписка и закупки — в одном месте, без кабинета как отдельного мира.

## Что это

Salon X помогает владельцу видеть день салона, мастеру — вести расписание и профиль, клиенту — записаться, поставщику — публиковать знания и принимать заказы.

Интерфейс тёмный (MIDNIGHT / SIGNAL). Стартовая страница владельца — отдельный глубокий teal-градиент, без фотографии на фоне.

## Основные возможности

- **Старт владельца** — имя салона, KPI дня, записи на выбранную дату, быстрые действия
- **Обзор** — настраиваемые виджеты (просмотр и режим правки)
- **Календарь** — день / 3 дня / неделя / месяц / список, рабочие часы, задачи и записи
- **Записи** — статусы, деталь визита, перенос, чат с клиентом
- **Профили мастеров** — публичная страница, услуги, портфолио, запись
- **Портфолио** — сетка работ с категориями
- **Контакты** — адресная книга и переход в переписку
- **Сообщения** — чаты с вложениями
- **Типы мастера** — профессии (колорист, парикмахер и др.), не путать с форматом занятости
- **Салон и команда** — настройки, сотрудники, график
- **QR-приглашение** — мастер сканирует код, регистрируется и сразу попадает в салон
- **Поставщик** — каталог, заказы, склад, команда
- **Косметика** — закупка мастером у поставщика, самовывоз в филиал
- **База знаний** — статьи поставщика для мастеров
- **PWA** — установка на домашний экран, кэш оболочки, API всегда из сети
- **Адаптивный интерфейс** — боковое меню на широком экране, нижняя навигация на телефоне

## Роли

Роли не выдуманы: они совпадают с identity и членством в организации.

| Кто | Что это |
| --- | --- |
| Владелец салона | Мастер с форматом занятости «владелец». Видит старт салона, команду, QR, аналитику |
| Администратор салона | Операции салона, команда, выдача заказов. Не владеет салоном |
| Мастер салона | Сотрудник. Своё расписание, записи, портфолио |
| Частный мастер | Работает без обязательного салона. Профиль, календарь, запись клиентов |
| Арендатор кресла / выездной | Работа в чужом салоне или на выезде. Своё кресло арендовать в *этом* салоне нельзя |
| Клиент | Поиск мастера, запись, свои визиты, магазин, сообщения |
| Поставщик | Каталог, склад, база знаний, заказы |
| Представитель поставщика | Полевые задачи и склад поставщика |
| Администратор платформы | Справочники и модерация (не публичная регистрация) |

Публичная регистрация: клиент, мастер, поставщик.

## Основные сценарии

1. Владелец входит → видит день салона → открывает расписание или запись → пишет клиенту → создаёт QR для нового мастера.
2. Мастер входит → правит профиль и типы → ведёт календарь и портфолио → принимает записи.
3. Клиент ищет мастера в своём городе → выбирает услугу, день и время → подтверждает запись.
4. Поставщик публикует статью и товары → мастер оформляет заказ с филиалом получения.

Подробно: [docs/USER_FLOWS.md](docs/USER_FLOWS.md), показ заказчику: [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md).

## Tech stack

Фактический стек репозитория:

| Слой | Технологии |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 6, React Router 7, TanStack Query 5, FullCalendar 6, TipTap |
| Backend | Go 1.26, стандартный `net/http`, pgx |
| API edge | Gateway на `:8090`, без бизнес-логики |
| Данные | PostgreSQL 16, отдельная БД на сервис |
| Файлы | MinIO (S3-совместимое хранилище) |
| Сообщения | NATS (инфраструктура; пользовательский мессенджер идёт через HTTP communications) |
| Сборка | Docker Compose, nginx для production SPA |

Микросервисы: `identity`, `organizations`, `marketplace`, `booking`, `clients`, `commerce`, `communications`, `media`.

## Local development

Нужны Docker (порты **5173**, **8090**, **5433**, MinIO 9000/9001) и, для разработки без контейнера frontend, Node.js 20+.

```bash
cp .env.example .env
docker compose up -d --build
docker compose --profile seed run --rm seed
```

PowerShell:

```powershell
Copy-Item .env.example .env
docker compose up -d --build
.\scripts\seed.ps1
```

Открыть:

- UI: http://127.0.0.1:5173
- API: http://127.0.0.1:8090
- Health: http://127.0.0.1:8090/healthz

Frontend в dev проксирует `/v1` на gateway. `VITE_API_BASE_URL` для локального Vite можно оставить пустым.

Без полного стека приложений:

```bash
docker compose up -d postgres nats minio
# поднять Go-сервисы (scripts/dev-local.ps1) → gateway :8090
cd frontend
npm install
npm run dev
```

Сброс демо-данных (удаляет тома Postgres и MinIO):

```bash
docker compose down -v
docker compose up -d --build
docker compose --profile seed run --rm seed
```

## Environment

Шаблоны: [`.env.example`](.env.example) (локально), [`.env.production.example`](.env.production.example) (сервер). Реальные секреты не коммитить.

| Переменная | Назначение |
| --- | --- |
| `JWT_SECRET` | Подпись access JWT. В production ≥ 32 символа, не dev-значение |
| `INTERNAL_TOKEN` | Вызовы сервис↔сервис. Не светить во frontend |
| `CORS_ORIGINS` | Явный список origin. В production нельзя `*` |
| `VITE_API_BASE_URL` | URL API, вшивается в сборку SPA. В production Docker — пустая строка (same-origin `/v1`) |
| `PUBLIC_APP_URL` | Публичный origin приложения (ссылки QR) |
| `APP_ENV` | `production` включает жёсткую проверку секретов |
| `POSTGRES_PASSWORD` | Пароль суперпользователя Postgres |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | Доступ к объектному хранилищу |
| `SEED_PASSWORD` | Пароль demo-аккаунтов. Только стенд, не бой |
| `ALLOW_SEED` | Seed при `APP_ENV=production`. На реальном бою — `false` |
| `ALLOW_DEV_BILLING` | В production должно быть `false` |

Значения по умолчанию из `.env.example` — только для локальной машины.

## Tests

```bash
cd frontend
npx tsc -b
npx vitest run
npx vite build
npm audit --omit=dev

cd ../backend
go test ./...
# уязвимости стандартной библиотеки / модулей:
go run golang.org/x/vuln/cmd/govulncheck@latest ./...
```

Релиз-критичные e2e (нужен живой API и seed):

```bash
cd frontend
npx playwright test e2e/security.spec.ts e2e/hardening.spec.ts e2e/demo-mvp.spec.ts e2e/pwa.spec.ts e2e/visit-plan.spec.ts --project=phone-390 --project=desktop-1920
```

Полный исторический `salon-x` suite не является критерием релиза: часть сценариев устарела относительно текущего UX.

Последние зафиксированные результаты: [docs/RELEASE_REPORT.md](docs/RELEASE_REPORT.md).

## Production

Кратко:

1. Скопировать `.env.production.example` → `.env` и заменить все `REPLACE_ME`.
2. `APP_ENV=production`, явный `CORS_ORIGINS`, HTTPS, уникальные секреты.
3. Сборка и запуск через Docker Compose (frontend nginx отдаёт SPA и проксирует `/v1`).
4. Миграции применяются при старте сервисов.
5. Seed на боевом контуре не включать.

Пошагово: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Чеклист: [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).

На хостах сборки и рантайма — **Go 1.26.6+**.

## Security

Скрытие кнопки во frontend не является защитой. Права проверяет backend.

Документ: [docs/SECURITY.md](docs/SECURITY.md).

## Documentation

| Документ | Содержание |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Слои, сервисы, границы безопасности |
| [docs/ROLES_AND_PERMISSIONS.md](docs/ROLES_AND_PERMISSIONS.md) | Роли и возможности |
| [docs/USER_FLOWS.md](docs/USER_FLOWS.md) | Пошаговые сценарии |
| [docs/CALENDAR.md](docs/CALENDAR.md) | Календарь и жесты |
| [docs/BOOKING.md](docs/BOOKING.md) | Запись и статусы |
| [docs/MEDIA.md](docs/MEDIA.md) | Загрузка и доступ к файлам |
| [docs/SECURITY.md](docs/SECURITY.md) | Auth, IDOR, CORS, секреты |
| [docs/PWA.md](docs/PWA.md) | Manifest и service worker |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Выкат на сервер |
| [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md) | Показ заказчику / фокус-группа |
| [docs/SCREENSHOTS.md](docs/SCREENSHOTS.md) | Снимки актуального UI |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | MIDNIGHT / SIGNAL |
| [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) | Чеклист выката |
| [docs/RELEASE_REPORT.md](docs/RELEASE_REPORT.md) | Фактический статус релиза |

Исторические ADR — в `docs/adr/`. Старые отчёты в корне репозитория описывают прошлые итерации и не заменяют документы выше.

# Architecture

Фактическая схема текущей версии. Нет отдельного reporting-сервиса и нет BFF с бизнес-правилами.

```text
Браузер (React SPA / PWA)
        │  HTTPS или same-origin /v1
        ▼
   Gateway :8090
        │  JWT на публичных маршрутах
        │  /v1/internal/* снаружи не проксируется
        ▼
   Сервисы (каждый со своей PostgreSQL)
        ├── identity
        ├── organizations
        ├── marketplace
        ├── booking
        ├── clients
        ├── commerce
        ├── communications
        └── media ──► MinIO (объектное хранилище)

   NATS — инфраструктура compose, не пользовательский канал чата
```

Gateway проверяет JWT, режет внутренние пути, выставляет CORS и security headers, маршрутизирует JSON. Доменные правила живут в сервисах.

## Frontend

- React 19 + Vite + React Router 7 + TanStack Query.
- Сессия: `localStorage` ключ `zb.auth` (access + refresh + user).
- Возможности UI: `cabinet.can()` по роли и формату занятости. Это навигация, не авторизация.
- API-клиент: `frontend/src/shared/api/client.ts`. В production `VITE_API_BASE_URL` пустой — запросы идут на `/v1` того же origin (nginx проксирует gateway).
- Ошибки пользователю: `app-error.ts` (русские формулировки, без stack / UUID / сырого SQL).

## Gateway

- Публичная точка `GET/POST /v1/*`.
- `GET /v1/internal/*` с браузера отвечает **404** (маршрут не смонтирован наружу).
- Сервисы вызывают друг друга с заголовком `X-Internal-Token`.
- CORS: список из `CORS_ORIGINS`. При `APP_ENV=production` значение `*` запрещено и роняет процесс.

## Authentication

- Access JWT + refresh (refresh хранится hashed в identity).
- `/v1/auth/login`, `/v1/auth/refresh`, `/v1/auth/logout`, `/v1/auth/me`.
- Просроченный или отозванный токен: frontend гасит сессию и один раз показывает «Сессия завершилась. Войдите снова.» Обычный заход на `/login` этого текста не показывает.

## Authorization

Каждый защищённый ресурс проверяется на стороне сервиса:

- владелец объекта **или**
- членство в организации с нужной ролью **или**
- участник записи / диалога.

Чужой UUID, чужой салон, клиент на ресурсах владельца, поставщик на календаре салона — **403/404**. Скрытие пункта меню не считается защитой.

Подробности: [ROLES_AND_PERMISSIONS.md](ROLES_AND_PERMISSIONS.md), [SECURITY.md](SECURITY.md).

## Сервисы

| Сервис | Отвечает за |
| --- | --- |
| identity | Пользователи, роли, сессии, подписка |
| organizations | Салоны и поставщики как организации, филиалы, membership, QR-invite, команда, задачи представителей |
| marketplace | Профили мастеров, услуги, поиск, портфолио, типы профессий, база знаний, окна `fixed_window` |
| booking | Рабочие часы, слоты, записи, календарь организации, planner blocks, схема визита, аренда кресел |
| clients | Карточки клиентов в контуре салона |
| commerce | Товары, склад, корзина, заказы мастера у поставщика, магазин клиента, самовывоз |
| communications | Контакты, мессенджер, уведомления, отзывы |
| media | Загрузка, метаданные, подпись URL, выдача байтов |

## Media

Один pipeline: `POST /v1/media`. Тип определяется по magic bytes, не по расширению. Ключ в бакете случайный. Удаляет только владелец файла. Публичные purpose (профиль, салон, портфолио, товар, статья, услуга, видео) читаются намеренно — это витрина, не IDOR. Сообщения и фото «до/после» — по доступу к диалогу или записи.

[MEDIA.md](MEDIA.md)

## Booking и calendar

Booking владеет записями и пересечениями (exclusion constraint). Marketplace отдаёт слоты и фиксированные сеансы. Календарь салона (`/v1/calendar/appointments`) доступен owner/admin этой организации. Личный календарь мастера — свои записи и свои блоки планировщика.

[BOOKING.md](BOOKING.md), [CALENDAR.md](CALENDAR.md)

## Marketplace и knowledge

Поиск мастеров, публичный профиль, портфолио. База знаний: автор или owner/admin организации-поставщика пишет; черновики не светятся посторонним (для них — 404).

## Messaging

HTTP communications: беседы, сообщения, вложения через media purpose `message`. Доступ — участники беседы.

## Database

Один Postgres в compose, **отдельные базы и учётки** на сервис: `identity`, `organizations`, `marketplace`, `booking`, `clients`, `commerce`, `communications`, `media`. Миграции: `backend/services/*/migrations`, накатываются при старте сервиса. Идентификаторы — UUIDv7. Деньги — минорные единицы.

## Storage

MinIO. Метаданные в БД media. Объектный ключ: `purpose/ownerId/id.ext`.

## PWA

VitePWA, `generateSW`. HTML — NetworkFirst, `/v1` и `/api` — NetworkOnly, `cleanupOutdatedCaches`. В dev service worker выключен, пока не задан `VITE_PWA_DEV=true`.

[PWA.md](PWA.md)

## Граница frontend / backend

| Слой | Можно | Нельзя считать защитой |
| --- | --- | --- |
| Frontend | спрятать кнопку, редирект, `cabinet.can()` | доступ к чужим данным |
| Backend | membership, owner, роль JWT | надежда, что клиент «не вызовет API» |
| Gateway | отрезать internal, CORS, JWT parse | решать, чей это заказ |

Исторический черновик «пустого репозитория» заменён этим файлом. ADR в `docs/adr/` описывают ранние решения (JWT, overlap, платежи без PSP) и остаются справкой, не картой текущего UI.

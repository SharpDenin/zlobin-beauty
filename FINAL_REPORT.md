# FINAL_REPORT.md — Zlobin Beauty MVP

Дата: 2026-08-09

## 1. Что было в проекте до изменений

Монорепозиторий beauty-платформы:

- **Frontend:** React + TypeScript + Vite, единый CSS kit (`styles.css`), auth через JWT.
- **Backend:** Go-микросервисы за HTTP gateway: `identity`, `organizations`, `marketplace`, `booking`, `clients`, `commerce`, `communications`, `media`.
- **PostgreSQL:** БД-на-сервис, миграции при старте.
- **Уже работало (Stage 1–4):** регистрация/логин, роли client/master/system_admin, салоны/филиалы, профиль мастера, услуги, рабочие часы, поиск, слоты с учётом длительности, запись и lifecycle, карточки клиентов/визиты/формулы, отзывы, медиа (MinIO), commerce (склад, B2B-заказы, B2C shop, rep, долги), отчёты салона, админ-справочники.
- **Не было:** seed demo-данных, JWT-роли supplier, auto-confirm Master↔Client, базы знаний, Docker frontend, публикации API на занятый `:8080`.

Scope предыдущих волн был шире текущего MVP (салон, склад, магазин, реп, KPI).

## 2. Что было переиспользовано

- Вся сервисная архитектура, gateway, shared-пакеты, Docker backend images.
- Auth (Argon2 + JWT + refresh), org memberships, master readiness.
- Booking: слоты, overlap exclusion, статусы записи.
- Clients: карточки, визиты, заметки, color formulas.
- Commerce: products, locations, supplier_orders + state machine.
- Frontend design tokens / layout shell / формы / money & status helpers.
- Playwright/Vitest инфраструктура (без переписывания e2e под MVP).

## 3. Что было удалено

Жёсткого удаления доменных сервисов/таблиц **не делалось** (по выбору: hide UI).

Точечные правки:

- Убран публичный маршрут `GET /v1/masters/by-user/{userID}` из ServeMux (конфликт с Go 1.22+ и `/v1/masters/{id}/portfolio`); lookup по user_id встроен в `GET /v1/masters/{id}` fallback.
- Из primary nav убраны ссылки на out-of-scope разделы (см. §4).

## 4. Что было скрыто

Маршруты могут оставаться доступны по прямому URL, но **не показываются в навигации**:

| Раздел | Path | Причина |
|--------|------|---------|
| Магазин клиента | `/shop` | B2C вне MVP |
| Склад | `/warehouse` | склад/нормы/прогноз вне MVP |
| Отчёты салона | `/reports` | salon admin analytics вне MVP |
| Доставки (rep) | `/rep` | логистика/представитель вне MVP |
| Справочники admin | `/admin/catalogs` | не часть user MVP |
| Уведомления | `/notifications` | убрано из MVP-навигации для компактности |

## 5. Что реализовано

### Client
- Поиск мастеров: город, текст, услуга, цена min/max, дата доступности.
- Карточка мастера → услуга → слоты (длительность учитывается) → заявка.
- Мои записи.

### Master
- Кабинет: орг/филиал, профиль, расписание, услуги (+ PATCH услуги: цена/длительность/активность).
- Записи: подтверждение / отклонение (`/reject`).
- Календарь (список записей по дням).
- Клиенты + карточка: история, заметки, формулы; **auto-confirm** на пару Master↔Client.
- Косметика: browse published-каталога поставщика, корзина, B2B-заказ, статус заказов.
- База знаний: список и статья.

### Supplier
- Роль `supplier` при регистрации.
- Каталог товаров, обработка B2B-заказов:  
  `new → confirmed → picking → in_transit → delivered` (+ `cancelled`), поле `estimated_delivery_at`.
- Публикации в базе знаний.

### Infra
- Frontend в Docker (nginx SPA).
- Seed CLI + compose profile `seed`.
- Gateway host port **8090**.

## 6. Backend changes

| Область | Изменение |
|---------|-----------|
| identity | Роль `supplier`, `as_supplier` в register (взаимоисключение с `as_master`) |
| booking | Таблица `master_client_settings`, auto-confirm при create, API GET/PUT auto-confirm, `POST .../reject` |
| marketplace | Фильтры поиска, `PATCH /v1/services/{id}`, knowledge base CRUD/list, resolve master by user_id |
| commerce | `estimated_delivery_at`, publish catalog browse без membership, transition передаёт ETA |
| gateway | `/v1/knowledge`, `/v1/me/clients/` |
| seed | `cmd/seed` demo data |

## 7. Frontend changes

- Role-based nav + `RequireSupplier`.
- Register: Client / Master / Supplier.
- Новые страницы: Calendar, Cosmetics, Knowledge list/article.
- Search filters; ClientCard auto-confirm; Appointments reject.
- Supplier panel: товары + B2B статусы + ETA.
- Скрытие out-of-scope вкладок.

## 8. Database changes

| Сервис | Миграция | Суть |
|--------|----------|------|
| booking | `004_client_auto_confirm.sql` | `master_client_settings (master_user_id, client_user_id, auto_confirm)` |
| marketplace | `005_knowledge_base.sql` | `knowledge_articles` |
| commerce | `005_order_estimated_delivery.sql` | `supplier_orders.estimated_delivery_at` |

Связь auto-confirm: **только** Master user ↔ Client user (не глобальный флаг клиента).

## 9. API

Основные endpoint’ы MVP (через gateway):

| METHOD | PATH | ROLE | DESCRIPTION |
|--------|------|------|-------------|
| POST | `/v1/auth/register` | Public | Регистрация (`as_master` / `as_supplier`) |
| POST | `/v1/auth/login` | Public | Логин |
| POST | `/v1/auth/refresh` | Public | Refresh |
| POST | `/v1/auth/logout` | Public | Logout |
| GET/PATCH | `/v1/auth/me` | JWT | Профиль / город |
| POST | `/v1/organizations` | JWT | Создать салон/поставщика |
| GET | `/v1/organizations/mine` | JWT | Мои организации |
| PATCH | `/v1/branches/{id}` | org admin | Филиал / publish |
| GET | `/v1/masters` | Public/JWT | Поиск (`city,q,service,price_min,price_max,available_on`) |
| GET | `/v1/masters/{id}` | Public | Профиль (+ fallback по user_id) |
| PUT/GET | `/v1/me/master` | master | Профиль мастера |
| POST | `/v1/services` | master | Создать услугу |
| PATCH | `/v1/services/{id}` | master | Изменить услугу / active |
| PUT/GET | `/v1/me/working-hours` | master | Расписание |
| GET | `/v1/masters/{userId}/slots` | Public | Свободные слоты |
| POST | `/v1/appointments` | client | Создать запись |
| GET | `/v1/appointments/mine` | JWT | Список записей |
| POST | `/v1/appointments/{id}/confirm` | master | Подтвердить |
| POST | `/v1/appointments/{id}/reject` | master | Отклонить |
| POST | `/v1/appointments/{id}/cancel` | party | Отмена |
| POST | `/v1/appointments/{id}/start\|complete\|no-show` | master | Lifecycle визита |
| GET/PUT | `/v1/me/clients/{clientUserId}/auto-confirm` | master | Auto-confirm для пары |
| GET | `/v1/clients/mine` | master | Клиенты |
| GET | `/v1/clients/id/{id}` | party | Карточка |
| GET | `/v1/clients/id/{id}/visits` | party | История |
| POST | `/v1/clients/id/{id}/notes` | master | Заметка |
| POST/GET | `/v1/clients/id/{id}/formulas` | master | Формулы |
| GET/POST | `/v1/commerce/locations` | org | Локации склада |
| GET/POST/PUT | `/v1/commerce/products` | JWT | Товары (чужой org → только published) |
| POST/GET | `/v1/commerce/supplier-orders` | JWT | B2B заказы |
| POST | `/v1/commerce/supplier-orders/{id}/transition` | supplier/buyer | Смена статуса (+ ETA) |
| GET | `/v1/knowledge` | Public/JWT | Список статей |
| GET | `/v1/knowledge/{id}` | Public/JWT | Статья |
| POST/PUT | `/v1/knowledge` | JWT | Создание/редактирование |

## 10. Test accounts

| Role | Login | Password |
|------|-------|----------|
| Client | `client1@demo.local` | `Password123!` |
| Client | `client2@demo.local` | `Password123!` |
| Master | `master1@demo.local` | `Password123!` |
| Master | `master2@demo.local` | `Password123!` |
| Supplier | `supplier1@demo.local` | `Password123!` |

Seed также включает: услуги/расписание мастеров, товары поставщика, статьи KB, записи, формулы, заказы в статусах `new` и `picking`.  
`client1` ↔ `master1`: auto-confirm **включён** после seed.

## 11. Docker — запуск с нуля

### Программы

1. Git  
2. Docker Desktop (Windows) / Docker Engine + Compose plugin  

### Шаги

```bash
git clone <your-fork-or-url> zlobin-beauty
cd zlobin-beauty
cp .env.example .env
# при необходимости отредактируйте JWT_SECRET / VITE_API_BASE_URL
docker compose up -d --build
docker compose --profile seed run --rm seed
```

Откройте http://localhost:5173

| Что | URL / значение |
|-----|----------------|
| Frontend | http://localhost:5173 |
| Backend / API | http://localhost:8090 |
| Health | http://localhost:8090/healthz |
| Swagger | нет |
| Postgres host/port | `localhost:5433` |
| Postgres user/pass | `postgres` / `postgres` |
| Service DB example | `identity` / user `identity` / pass `identity` |

Логи:

```bash
docker compose logs -f gateway frontend booking commerce
```

Перезапуск:

```bash
docker compose restart
```

Полная очистка БД и повторный подъём:

```bash
docker compose down -v
docker compose up -d --build
docker compose --profile seed run --rm seed
```

Миграции: автоматически при старте сервисов.  
Seed: повторный запуск обычно идемпотентен (логин существующих пользователей + create-with-skip).

> Если `8090` занят — смените mapping в `docker-compose.yml` и `VITE_API_BASE_URL`, затем пересоберите frontend.

## 12. Как мне протестировать приложение

### Подготовка

1. Выполните §11 (stack + seed).  
2. Откройте http://localhost:5173  

### Client

1. Войти: `client2@demo.local` / `Password123!` (без auto-confirm у master1).  
2. **Поиск** → город `Москва` → Искать.  
3. Ожидание: мастера Анна / Иван.  
4. Открыть Анну → услуга «Стрижка» → дата (рабочий день) → свободный слот → записаться.  
5. **Мои записи**: статус `ожидает подтверждения` / `pending_confirmation`.  

### Master appointment

1. Войти: `master1@demo.local` / `Password123!`.  
2. **Записи** → заявка client2 → **Подтвердить**.  
3. **Календарь** → запись на дату.  
4. Открыть запись → Start → Complete.  
5. **Клиенты** → карточка → история визита.  

### Auto-confirm

1. Master1 → карточка client2 → включить «Автоподтверждение».  
2. Войти client2 → создать ещё одну запись к master1.  
3. Ожидание: статус сразу **confirmed**.  
4. Войти client2 → запись к master2 (или client1 без флага у другого мастера): снова нужен confirm.  
5. Seed уже включил auto-confirm для client1↔master1 — можно проверить и на нём.  

### Services

1. Master1 → **Кабинет** → добавить услугу с длительностью 180 мин.  
2. Client → слоты на эту услугу: шаг/окончание учитывают 3 часа (нельзя «запихать» в короткий хвост).  

### Schedule

1. Master1 → кабинет → изменить working hours (например, убрать пятницу).  
2. Client → слоты на пятницу пустые / ошибка при бронировании вне часов.  

### Supplier order

1. Seed log: скопировать `demo supplier_org_id=…`.  
2. Master1 → **Косметика** → создать склад (если нет) → вставить UUID поставщика → товары в корзину → заказ.  
3. Supplier1 → **Товары** → заказ → `confirmed` → `picking` → указать ETA → `in_transit` → `delivered`.  
4. Master1 видит обновлённый статус.  

### Client card / formula

1. Master1 → Клиенты → карточка.  
2. Добавить заметку к визиту.  
3. Сохранить формулу (бренд, компоненты, окислитель, пропорция).  
4. Переоткрыть — данные на месте (seed уже создал демо-формулу).  

### Knowledge base

1. Master1 → **База знаний** → список ≥3 статей.  
2. Открыть статью → текст читается.  

### Permissions

1. Client не видит «Кабинет / Косметика / Клиенты».  
2. Supplier не видит клиентский поиск в nav (его nav: Товары / База / Профиль).  
3. Прямой заход на `/warehouse` как клиент — guard/ошибка доступа.  

### Mobile responsive (~390px)

1. DevTools → 390×844.  
2. Пройти login → поиск → запись → (master) нижняя навигация без горизонтального overflow.  
3. Формы полей на всю ширину, bottomnav кликабелен.  

## 13. Automated tests performed

| Command | Result |
|---------|--------|
| `gofmt` (изменённые пакеты) | PASS |
| `go test ./...` (backend) | PASS (`shared/auth`, `booking/.../domain`) |
| `go vet ./...` | PASS |
| `go build ./...` | PASS |
| `npm run build` (frontend) | PASS |
| `docker compose config` | PASS |
| `docker compose up -d --build` | PASS (после смены порта на 8090 и `down -v`) |
| `docker compose --profile seed run --rm seed` | PASS (`seed complete`) |
| Smoke: login + `/v1/masters?city=Москва` | PASS (2 masters) |
| Smoke: `/v1/knowledge` | PASS (3 articles) |
| Smoke: master lists supplier products | PASS (3 products) |

Не запускалось в этой сессии: полный Playwright e2e suite, `npm test` unit (Vitest), browser UI walkthrough всех сценариев вручную в Chromium.

## 14. Known issues

1. **Косметика:** мастер вручную вводит UUID org поставщика (нет публичного каталога поставщиков). Seed печатает id в лог.  
2. **Мастер = также client в JWT**, но nav приоритетно мастерский — клиентский поиск с мастерского аккаунта не в bottom nav (можно открыть URL `/search`).  
3. **Салон-модель** остаётся техническим фундаментом (org/branch/publish) — упрощённый UX «мастер без салона» не делался.  
4. **Скрытые разделы** (`/shop`, `/warehouse`, …) не удалены из кода; deep-link возможен при наличии роли.  
5. Host **8080** на многих машинах занят — выбран **8090**; документация отражает это.  
6. Commerce image иногда кешируется Docker на Windows — при странном поведении: `docker compose build --no-cache commerce`.  
7. Нет Swagger UI.  
8. Frontend Dockerfile bake’ит `VITE_API_BASE_URL` на build-time — смена URL API требует rebuild frontend.

## 15. Что можно делать следующим этапом

- Каталог поставщиков для мастера (без ручного UUID).  
- Отдельные страницы услуг / редактор повторяющихся выходных.  
- Вернуть уведомления в nav.  
- E2E Playwright на новые MVP-flows.  
- Упростить онбординг мастера без лишних salon checklists.  
- Постепенно вырезать/архивировать shop/rep/warehouse, если продукт подтвердит отказ.

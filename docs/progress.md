# Progress

## Discovery (2026-08-01)

### Found structure

- Git repo on `main`, single commit `Initial commit`.
- Present: Go-oriented `.gitignore`, empty `frontend/`, `backend/` with JetBrains `.idea` only.
- Absent: application code, Compose, migrations, docs, CI.
- Host: Node 22 / npm 10, Docker 29; Go 1.26 installed during this session.

## Stage 1 (complete)

Vertical slice verified on real PostgreSQL:

`register → salon → master profile → service → schedule → client search → book → master confirm`

Services: identity, organizations, marketplace, booking, gateway. Frontend React/Vite. Docs + ADRs 001–005.

Local host ports: Go `8101–8104`, gateway `8090` (8080 occupied). Compose: Postgres `5433`, NATS.

## Quality pass + Stage 2 (complete enough for visits/reviews)

- Appointment lifecycle, notifications, reviews, client cards.
- Playwright Stage 1+2 on phone-390 green.
- Visit photos / MinIO still deferred to wave B.

## Wave A–D (2026-08-05) — fill + mockup coverage

### Документация

- `docs/dashboard-coverage.md` — сопоставление 12 макетов, KPI-источники, фейковые места, волны A–G.

### Онбординг / публикация

| Возможность | Статус |
|-------------|--------|
| Master readiness `GET /v1/me/master/readiness` + блок публикации | готово |
| Org/branch readiness + PATCH publish (только при checklist) | готово |
| Поиск мастеров учитывает `branch.published` | готово |
| Popular services учитывает branch publication | готово |
| UI checklist в кабинете мастера | готово |

### Commerce (Stage 3 foundation)

Сервис `commerce` :8107 / Compose; БД `commerce`.

| API | Статус |
|-----|--------|
| Locations, products, stock movements (receipt/write_off/…) | готово |
| Stock list + status (sufficient/low/critical/out) | готово |
| Stock forecast (deficit; demand from booking org-range) | готово |
| Consumption norms | готово |
| Supplier orders + transition + accept → receipt movements | готово |
| Supplier dashboard KPI (оборот, заказы, товары, критические; delta %) | готово |

### Media (wave B foundation)

Сервис `media` :8108 + MinIO; БД `media`. Bucket `zlobin-media`, объекты приватные.

| API | Статус |
|-----|--------|
| `POST /v1/media` (multipart, sha256, 5 MiB) | готово |
| `GET /v1/media/{id}` / `/content` / `DELETE` | готово |
| `photo_media_id` на профиле мастера + UI загрузки | готово |
| Портфолио / салон / доставка UI | не реализовано |

### Frontend

| Экран | Статус |
|-------|--------|
| Home: masters/services/appointments из API, empty states | частично (город пока «Москва») |
| Master cabinet: org/master readiness, publish branch, фото | готово |
| Warehouse `/warehouse` | готово (товары, приёмка, прогноз, заказ поставщику, CSV import) |
| Supplier panel `/supplier` | готово (KPI с сервера; пустая база = нули) |
| Salon reports `/reports` | готово (KPI + CSV; null = недостаточно данных) |
| Shop `/shop` | готово (каталог, корзина, checkout, заказы, reorder) |
| Rep `/rep` | готово (список доставок без фиктивной карты, complete → debt) |

### Wave E–F (2026-08-06)

- Migration `002_client_shop.sql`: carts, client_orders, debt_ledger, status history
- Shop API under `/v1/commerce/shop/*`, rep under `/v1/commerce/rep/*`, CSV import under `/v1/commerce/imports/*`
- Повтор заказа: актуальные цены/наличие; multi-supplier cart rejected
- Задолженность считается ledger-ом, не редактируется вручную

### Wave G (2026-08-06)

- `GET /v1/reports/salon` + `GET /v1/reports/salon.csv` (booking): оборот, визиты, средний чек, повторы, загрузка мастеров, удовлетворённость, delta vs prev period
- `GET /v1/internal/reviews/stats` (communications): агрегат отзывов для salon report
- Stock reserve at checkout + forecast demand from confirmed/in_progress appointments (commerce, sibling)
- UI `/reports` для master/owner

### Wave H (2026-08-06)

- Complete визита → `POST /v1/internal/stock/consume-appointment` (нормы → consumption, идемпотентно)
- Нормы расхода UI на `/warehouse`
- Справочники system_admin: `/admin/catalogs` + API service/product categories
- Портфолио мастера (`004_portfolio.sql`) + просмотр на карточке мастера
- Рекомендации товаров мастера → блок в `/shop`
- Media: authenticated read для profile/portfolio/product/salon

### Wave I (2026-08-06)

- Единицы измерения: `units_of_measure` + CRUD `/v1/commerce/units` + UI в `/admin/catalogs`
- Варианты объёма: `products.parent_id`; каталог показывает корневые; detail отдаёт `variants`
- Warehouse: выбор unit из справочника, volume_label, привязка варианта к родителю
- Media: публичный GET metadata/content для profile/salon/portfolio/product (без логина)
- Фото филиала: `branch_photos` + API + UI в кабинете мастера

### Wave J (2026-08-06)

- Город в профиле: `users.city` + `PATCH /v1/auth/me`; Home/Search берут город из профиля
- Фото до/после визита: `appointment_photos` + API; UI на карточке записи
- Сегменты клиентов: `new/active/lapsed` в `GET /v1/clients/mine?segment=`; страница `/clients`
- Онбординг поставщика: создание org `type=supplier` на `/supplier`; панель фильтрует supplier-орги

### Следующее

1. Отдельный reporting projected read-model / audit journal
2. Фото товара в магазине
3. ABC/покупатели у поставщика
4. Избранное / фильтры поиска (цена, рейтинг)

См. `docs/dashboard-coverage.md`.

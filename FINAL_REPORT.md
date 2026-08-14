# FINAL_REPORT.md — Zlobin Beauty MVP

Дата: **2026-08-10**

Честный обзор production-readiness по коду, миграциям, seed и автотестам.  
Стек: React/Vite frontend → HTTP gateway `:8090` → Go-микросервисы → PostgreSQL per service; медиа через MinIO.

Демо-аккаунты (пароль `Password123!`):  
`client1@demo.local`, `client2@demo.local`, `master1@demo.local` … `master4@demo.local`, `supplier1@demo.local`, `supplier2@demo.local`.

См. также: `MANUAL_TEST.md`, `MANUAL_DEMO.md`, `README.md`.

---

## Production readiness review

**Implemented**

- Docker Compose поднимает Postgres, MinIO, NATS, сервисы, gateway (**host :8090 → :8080**), frontend (:5173).
- Миграции при старте сервисов; seed через API (`docker compose --profile seed run --rm seed` / `scripts/seed.ps1`).
- JWT access + refresh, роли `client` / `master` / `supplier` (+ claim `salon_owner` / `system_admin` в identity).
- MVP-потоки: поиск/запись, кабинет мастера, B2B-косметика, база знаний, lifecycle записей и заказов.

**Tested**

- Backend unit/интеграционные тесты (overlap, conflict mapping, delivery transitions, payment helpers, commerce order build).
- Frontend Vitest (status labels и др.).
- Playwright `frontend/e2e/demo-mvp.spec.ts` (устойчивые сценарии + skip при unhealthy API / failed login).
- Ручной demo-сценарий: `MANUAL_DEMO.md`.

**Known limitation**

- Не production HA: один gateway, нет rate-limit / WAF / JWT-verify на edge.
- Нет OpenAPI/Swagger UI.
- Out-of-scope маршруты (`/shop`, `/warehouse`, `/rep`, `/reports`, `/admin/catalogs`) остаются в бандле, скрыты из primary nav.
- Секреты `JWT_SECRET` / `INTERNAL_TOKEN` — dev defaults; нужны ротация и секрет-стор для prod.
- Observability: базовые логи контейнеров, без централизованных метрик/трейсинга.

---

## Scheduling correctness

**Implemented**

- Шаблон недели: `PUT/GET /v1/me/working-hours`.
- Исключения дня: `schedule_exceptions` (day-off / кастомные часы).
- `FreeSlots`: локальный день в timezone мастера → окна минус appointments и exceptions; шаг 30 мин; длительность услуги обязательна.
- Запись: `POST /v1/appointments` с `starts_at`; жизненный цикл confirm/reject/cancel/start/complete/no-show.
- Auto-confirm на пару Master user ↔ Client user (`master_client_settings`).
- UI wizard на карточке мастера: услуга → дата → слот → итог (гибкий режим).

**Tested**

- Go: overlap half-open `[start,end)`, conflict → apperr; concurrency-сценарий вокруг exclusion.
- Playwright: flexible booking path (soft skip, если слотов/seed нет).
- Seed создаёт demo-appointments и рабочие часы будней.

**Known limitation**

- Месячный grid-календарь не реализован (день/неделя + exceptions).
- Создание occurrence из UI через `datetime-local` = browser-local → UTC; при TZ браузера ≠ TZ салона возможен сдвиг.
- Reschedule для fixed-window запрещён; полноценного «переноса» гибкой записи в UI нет.

---

## Timezone strategy

**Implemented**

- Хранение: `TIMESTAMPTZ` (UTC-инстанты).
- IANA timezone на филиале / occurrence / `location_timezone` записи; слоты принимают `timezone` query.
- Resolve: явный param → TZ филиала мастера (marketplace → organizations) → fallback **`Europe/Moscow`**.
- Seed multi-city: Красноярск `Asia/Krasnoyarsk`, Новосибирск `Asia/Novosibirsk`, Москва `Europe/Moscow`.
- Frontend: `formatLocalInTimezone` / `formatRangeInTimezone` / `formatDualTime`.

**Tested**

- Seed workshop occurrence в `Asia/Krasnoyarsk` (14:00–18:00 локально).
- UI dual-time на fixed occurrences.

**Known limitation**

- Исторически были риски wall-clock в UTC; текущий `FreeSlots` резолвит IANA, но полный аудит всех вызовов вне happy-path не заявлялся.
- Клиентские даты (`input[type=date]`) без явной salon-TZ подсказки в гибком wizard.

---

## Fixed-window services

**Implemented**

- Миграция `009_booking_mode_occurrences.sql`: `services.booking_mode ∈ {flexible, fixed_window}`, таблица `service_occurrences` (starts/ends, timezone, capacity, booked_count, status, title/note).
- API: CRUD occurrences; internal book/release capacity; DTO `remaining = capacity - booked_count`.
- Booking: appointment с `occurrence_id` + `booking_mode`; capacity book atomичен (`booked_count < capacity`).
- UI клиент: выбор `.occurrence-card` («мест: N»); мастер: управление на Services.
- Seed: услуга Анны «Авторский мастер-класс по окрашиванию» + один scheduled occurrence (capacity 1).

**Tested**

- Playwright: fixed occurrence UI (skip, если сервис/seed отсутствует).
- Store/service constraints на occurrences + appointments.

**Known limitation**

- Unique index «один активный appointment на occurrence» фактически блокирует capacity > 1 на слое appointments, даже если marketplace считает capacity.
- Нет видео/стриминга для МК; это только запись на окно.

---

## Media uploads

**Implemented**

- Media-сервис + MinIO (`zlobin-media`): `POST /v1/media`, `GET /v1/media/{id}`, `/content`, delete.
- Purposes: profile/salon/portfolio/before_after/product/delivery/document/article/video.
- Лимиты: изображения/docs 5 MiB; video 50 MiB (MIME mp4/webm/quicktime при `purpose=video`).
- Public purposes отдаются через gateway `/content` без CDN.
- Frontend: `MediaDropzone` + `mediaUpload.ts` (jpeg/png/webp).

**Tested**

- Upload path используется в кабинетах/редакторах (products, articles cover, профиля где подключено).

**Known limitation**

- **Нет CDN и signed/presigned URL** — стриминг объекта через API (не подходит для крупных video в prod).
- UI dropzone — **только изображения**; video purpose в API есть, полноценного video UX нет.
- Seed часто оставляет placeholder без реальных фото.

---

## Commerce architecture

**Implemented**

- B2B: `supplier_orders` + line items (snapshot name/sku/price); каталог чужого org только published/for_sale.
- `GET /v1/suppliers` — карточки поставщиков без ручного UUID в master UX.
- Поля заказа (mig `007_delivery_payment.sql`): `destination_branch_id`, payment_*, money totals, `idempotency_key`.
- Отдельная сущность `order_deliveries` (одна активная non-cancelled/failed на заказ).
- Legacy B2C shop / warehouse / rep код сохранён, вне MVP nav.

**Tested**

- Go order_build / payment domain tests; Playwright cosmetics list без UUID; checkout филиала.
- Seed: товары, demo orders.

**Known limitation**

- Нет единого ERP-склада и прогноза; warehouse UI скрыт.
- Seed-заказы могут не заполнять все новые поля одинаково с UI checkout (ручной путь в UI — источник истины для pickup+payment).

---

## Delivery model

**Implemented**

- Отдельная state machine (`delivery_transitions.go`):  
  pending → scheduled | preparing | cancelled | failed; … → in_transit → arrived | delivered | failed и т.д.
- ETA: `estimated_delivery_at` на заказе; `planned_delivery_at` / window на delivery.
- Смена destination — пока delivery в `pending`.
- UI поставщика: запланировать доставку, переходы статусов; покупатель видит «Получение: {филиал}».

**Tested**

- Unit-тесты переходов delivery.
- Supplier orders UI wired to schedule/transition.

**Known limitation**

- Нет внешнего 3PL / трекинг-интеграции (поля provider/tracking — заготовка).
- Legacy статусы `in_transit`/`delivered` на самом заказе ещё допускаются рядом с delivery entity — два слоя статусов.

---

## Payment model

**Implemented**

- Методы (CHECK): `cash`, `bank_transfer`, `card`, `invoice`.
- Статусы (CHECK): `pending`, `awaiting_payment`, `authorized`, `paid`, `partially_paid`, `failed`, `refunded`, `cancelled`.
- Init: cash → `pending`; иначе → `awaiting_payment`.
- `POST .../mark-paid` (supplier owner/admin) → `paid` + `paid_at` (**ручная отметка**).
- UI: выбор способа оплаты; для `card` — hint «Онлайн-оплата будет подключена позже».

**Tested**

- Domain payment tests; UI labels (`paymentMethodLabel` / `paymentStatusLabel`).

**Known limitation**

- **Acquiring — mock/заглушка:** нет PSP, webhook, authorize/capture, refunds.
- Статусы `authorized` / `partially_paid` в схеме почти не используются живыми flow.

---

## Pickup branches

**Implemented**

- Mig `005_branch_pickup.sql`: `pickup_enabled` (DEFAULT true), geo, `working_hours_note`, `photo_media_id`.
- `GET /v1/branches/pickup`; create order валидирует published + pickup_enabled.
- Checkout косметики: поиск филиала по имени/городу/адресу, выбор карточки (не UUID).

**Tested**

- Playwright: блок «Филиал получения» без UUID-полей.
- Seed публикует филиалы салонов (default pickup true).

**Known limitation**

- Нет отдельного UI-мастера «настроить часы самовывоза» для всех сценариев beyond branch fields.
- Поставщицкие склады тоже branch entities; UX фокусируется на филиалах салона-покупателя.

---

## Knowledge rich content

**Implemented**

- Mig `010_knowledge_rich.sql`: `content_format ∈ {plain, doc_json}`, `cover_media_id`, `reading_time_minutes`.
- `RichDocEditor` / `RichDocRenderer` (TipTap); создание статей supplier с `doc_json`.
- Список/статья: cover, badges (brand/category), reading time, связанный product link.
- Авторство у supplier org; master читает published.

**Tested**

- Playwright: knowledge list + article page render.
- Seed: статьи (часто `plain` без cover — совместимо с renderer).

**Known limitation**

- Seed не заполняет rich doc_json / cover массово.
- Нет версиирования статей, модерации, full-text search advanced.

---

## Permissions/security

**Implemented**

- Argon2 passwords; JWT HS256 (access ~15m, refresh ~30d); roles в claims.
- Per-service BearerAuth + org membership checks (`owner|admin|master|staff`…).
- Frontend: `RequireAuth` / `RequireMaster` / `RequireSupplier` / `RequireAdmin`.
- Register: `as_master` / `as_supplier` (взаимоисключение).

**Tested**

- Role-based nav вручную и через e2e login под разными ролями.
- API unauthorized на protected маршрутах (штатное поведение сервисов).

**Known limitation**

- Gateway в основном reverse-proxy: **нет центральной JWT-верификации на edge**.
- `user_roles.role` без жёсткого DB CHECK на enum.
- Скрытые маршруты всё ещё доступны по прямому URL при наличии токена/слабого guard.
- INTERNAL_TOKEN для S2S — shared secret, без mTLS.

---

## Database constraints

**Implemented**

- Appointments: GiST `EXCLUDE` no-overlap на активных статусах; unique active per `occurrence_id`.
- Occurrences: no-overlap для того же master при `scheduled|full`; `booked_count <= capacity`.
- Commerce: CHECKs payment method/status; unique `(created_by, idempotency_key)` где ключ задан; одна активная delivery на заказ.
- Booking idempotency table (`007_idempotency.sql`) + `Idempotency-Key` на create appointment.

**Tested**

- `conflict_test.go` мапит exclusion → conflict; concurrency_test документирует `23P01`.

**Known limitation**

- Не все кросс-сервисные инварианты (marketplace capacity vs booking unique) согласованы идеально (см. Fixed-window).
- Нет распределённых транзакций между сервисами.

---

## Concurrency

**Implemented**

- Half-open interval overlap helper для слотов.
- DB exclusion + atomic capacity `UPDATE … WHERE booked_count < capacity`.
- Idempotency keys на create appointment.

**Tested**

- `overlap_test.go`, `concurrency_test.go`, `conflict_test.go`.

**Known limitation**

- Advisory locks не используются.
- Нагрузочного/chaos-теста в CI нет; e2e не бьёт параллельными бронями в prod-like объёме.

---

## Browser testing

**Implemented**

- Адаптивный shell, bottom nav / drawer «Ещё», русские статусы.
- Multi-city search default **Красноярск** + toggle «Показывать мастеров из других городов».
- Wizard flexible + fixed; cosmetics checkout с филиалом; knowledge article.

**Tested**

| Сценарий | Как | Результат / ожидание |
|----------|-----|----------------------|
| Search Красноярск + toggle → Иван (Новосибирск) | Playwright | PASS при поднятом seed |
| Flexible booking wizard | Playwright | PASS / skip если API или слоты недоступны |
| Fixed occurrence cards | Playwright | PASS / skip если нет fixed_window seed |
| Cosmetics pickup selection | Playwright | PASS при каталоге |
| Knowledge article | Playwright | PASS при статьях |
| Login / overflow 390px | Playwright responsive | PASS |

**Known limitation**

- Полный screen-share / MCP browser не заменяет приёмку; перед демо заказчику пройти `MANUAL_DEMO.md`.
- Playwright skips при down stack — зелёный CI без Docker ≠ доказанный runtime.

---

## Automated testing

**Implemented**

- Go: `go test ./…` (booking overlap/concurrency/conflict; commerce delivery/payment; и др.).
- Frontend: Vitest `npm test`; Playwright `npm run test:e2e` (`demo-mvp.spec.ts`, `responsive.spec.ts`).
- Defaults: API `http://localhost:8090`, UI `http://localhost:5173`; skip on unhealthy `/healthz` или failed login.

**Tested**

- Локально/в итерации MVP: unit + build + выборочный Playwright phone-390 / desktop-1440.

**Known limitation**

- Нет полного matrix CI всех viewports + обязательного docker compose в каждом PR (зависит от окружения).
- Stage1/2 API-driven e2e в `responsive.spec.ts` всё ещё создают Moscow masters — пересекаются с новым multi-city seed, но самодостаточны.

---

## Known production gaps

1. **Оплата:** acquiring mock; только ручной `mark-paid`.
2. **Медиа:** нет CDN/signed URLs; video через API proxy; UI upload без video.
3. **Capacity > 1** на fixed-window ломается appointment unique index.
4. **Gateway** без edge authz/rate-limit; shared INTERNAL_TOKEN.
5. **Observability / backups / миграции rollback** не оформлены prod-процессом.
6. **Out-of-scope UI** остаётся в бандле.
7. **Salon ERP** (сотрудники, %, полный owner cabinet) — только work_type framing.
8. **Доставка:** нет 3PL; dual status model order vs delivery.
9. **Нагрузка / failover** Postgres и MinIO single-node в compose.
10. **Seed ≠ полный rich knowledge/media** — демо-контент частично plain/placeholder.

---

Эти пробелы ожидаемы для MVP-демо 2026-08-10; закрывать по приоритету: payment acquiring → media CDN/signed URLs → capacity model alignment → edge security.

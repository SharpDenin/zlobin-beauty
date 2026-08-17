# FINAL_REPORT.md — Salon-X (corrective acceptance)

Дата: **2026-08-17**.  
Не опирается на предыдущий FINAL_REPORT. Проверено на clean seeded stack + Playwright `e2e/salon-x.spec.ts` (**39 passed**, skip только по viewport).

UI: **Salon-X** (`http://localhost:5173`). Пароль demo: `Password123!`.  
Внутренние Go paths `zlobin-beauty` не переименовывались.

Правило статуса: **DONE** только если одновременно есть модель, backend, permissions, полноценный UI, E2E без UUID, UX, seed, тест, проверка на поднятом стеке.

---

## Matrix (эта итерация)

| Requirement | DB | Backend | UI | UX | Permissions | Seed | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| 1 Name Salon-X | — | — | Y | Y | — | — | visual | **DONE** |
| 2 Knowledge Base | Y | Y | Y | Partial | Y | Y | e2e filter/fav | **PARTIAL** |
| 3 Knowledge favorites | Y | Y | Y | Y | Y | Y | e2e | **DONE** |
| 4 Article ↔ product/category | Y | Y | Y | Partial | Y | Y | code+seed | **PARTIAL** |
| 5 Supplier warehouse | Y | Y | Y | Partial | Y | Y | e2e | **PARTIAL** |
| 6 Supplier Representative | Y | Y | Y | Partial | Y | Y | e2e map/home | **PARTIAL** |
| 7 Product/service cards | Y | Y | Y | Partial | Y | Y | shop e2e | **PARTIAL** |
| 8 Role cabinets | Y | Y | Y | Partial | Y | Y | login all seed | **PARTIAL** |
| 9 Master auto-confirm | Y | Y | Y | Y | Y | Y | seed log | **DONE** |
| 10 Owner staff/schedules | Y | Y | Y | Partial | Y | Y | e2e staff | **PARTIAL** |
| 11 Business Calendar planner | Y | Y | Y | Partial | Y | Y | e2e modes | **PARTIAL** |
| 12 Master home + widgets | Y | Y | Y | Partial | Y | Y | e2e dashboard | **PARTIAL** |
| 13 Contextual hints | Y | Y | Y | Partial | Y | default on | code | **PARTIAL** |
| 14 Structured scheme | Y | Y | Y | Partial | Y | Partial | code | **PARTIAL** |
| 15 Audience + client shop | Y | Y | Y | Partial | Y | Y | API+shop e2e | **PARTIAL** |
| 16 Client contact policy | Y | Y | Y | Partial | Y | Y | e2e toggle | **PARTIAL** |
| 17 No-show blacklist | Y | Y | Y | Partial | Y | Y | API e2e | **PARTIAL** |
| 18 Recurring supply | Y | Y | Y | Partial | Y | Y | API e2e | **PARTIAL** |
| 19 Subscription/trial | Y | Y | Y | Partial | Y | Y | API+page e2e | **PARTIAL** |

---

## Requirement 1

### Original requirement
Название Salon-X.

### Status
DONE

### Implemented
Бренд в shell, login, client home, topbar.

### UI
Любой экран после входа: «Salon-X».

### Backend
Не требуется.

### Test
Визуально + e2e login.

### Known limitations
Внутренние package paths остаются `zlobin-beauty`.

---

## Requirement 2

### Original requirement
Knowledge Base: product/category links, multi filters, dropdown, quick chips, ranking, recommendations, favorites, rich inline photo/video, production UX.

### Status
PARTIAL

### Implemented
Список с поиском, категорией, брендом, chips (Избранное / Новое / окрашивание / уход / техника / продукция), секции «Рекомендованное», карточки с cover, TipTap editor с inline media, связь с товарами чекбоксами у поставщика.

### UI
`/knowledge`, `/knowledge/:id` — master/supplier.

### Backend
`GET/POST /v1/knowledge`, favorites, `content_format=doc_json`.

### Test
e2e: master → База знаний → chip «Для окрашивания» → статья → избранное.

### Known limitations
Нет searchable multi-select «поставщик / конкретный товар». Ranking упрощённый (порядок API + «новое» за 14 дней). Editorial hub ещё не на уровне профессиональной библиотеки.

---

## Requirement 3

### Original requirement
Knowledge favorites.

### Status
DONE

### Implemented
Toggle избранного на карточке статьи, фильтр chip «Избранное».

### UI
Деталь статьи, кнопка избранного.

### Backend
`POST/DELETE /v1/knowledge/{id}/favorite`, `?favorites=1`.

### Test
e2e favorite click.

### Known limitations
Нет отдельной страницы «только избранное» кроме фильтра.

---

## Requirement 4

### Original requirement
Supplier article → product/category relation.

### Status
PARTIAL

### Implemented
Категория поля + чекбоксы товаров поставщика при создании/редактировании.

### UI
Редактор на `/knowledge` у supplier.

### Backend
`product_ids` на статье.

### Test
Seed articles с product links; UI чекбоксы.

### Known limitations
Нет отдельного UX «статьи по продуктам» как витрины категорий; связь видна в карточке/детали.

---

## Requirement 5

### Original requirement
Supplier warehouse.

### Status
PARTIAL

### Implemented
Раздел «Склад»: карточки товара, available, reserved (supplier), статусы, search/filter, движения. Rep видит три человеческих статуса.

### UI
`/warehouse`.

### Backend
`GET /v1/commerce/stock`, `GET /v1/commerce/stock/movements` (добавлен list).

### Test
e2e heading «Склад» под supplier1.

### Known limitations
Фото зависят от `photo_media_id` товара. Салонский склад по-прежнему смешан с нормами/CSV (скрыты у supplier/rep). Не отдельный WMS.

---

## Requirement 6

### Original requirement
Supplier Representative: stock, route map, optimization, salon visits, tasks, monitoring, planner, amount to collect, day/month, sales analytics, supplier analytics.

### Status
PARTIAL

### Implemented
Кабинет `/rep`: KPI, задачи, `/rep/map` Leaflet+OSM, optimize, `/rep/finance`, `/rep/analytics` charts, склад, supplier analytics + team cards + create task (салон/дата/priority).

### UI
`/rep`, `/rep/map`, `/rep/finance`, `/rep/analytics`, `/supplier/team`, `/supplier/analytics`.

### Backend
routes+stops, `GET /v1/commerce/rep/analytics`, supplier analytics, tasks.

### Test
e2e: «Кабинет представителя», «Карта маршрута», `.leaflet-container`.

### Known limitations
Optimize использует adapter (haversine), не production routing provider. Маркерные координаты seed/recommend — не живой GPS. Мониторинг представителя у supplier — карточки, не полный drill-down schedule/route/performance.

---

## Requirement 7

### Original requirement
Simple product/service cards.

### Status
PARTIAL

### Implemented
Shop/product cards: фото, бренд, цена, наличие. Услуги — карточки/список в `/services`.

### UI
`/shop`, `/services`, `/cosmetics`.

### Test
e2e shop catalog heading.

### Known limitations
Не все каталоги одинаково «карточечные»; часть salon-страниц всё ещё list-item.

---

## Requirement 8

### Original requirement
Roles with separate cabinets: Client, Master types, Salon/Chain Owner, Admin, Supplier, Rep.

### Status
PARTIAL

### Implemented
`cabinet.tsx`: nav по `role` + `work_type`. Реп не видит client home. Owner видит staff/reports, private master — нет. Client видит Shop.

### UI
Sidenav + bottom nav + label кабинета.

### Backend
JWT roles + `/v1/me/master.work_type` + memberships.

### Test
Все seed-аккаунты логинятся. e2e client/master/supplier/rep.

### Known limitations
Типы мастеров делят много экранов (calendar/clients). Различие в основном в навигации, не в полностью разных приложениях. Chain switcher — localStorage.

---

## Requirement 9

### Original requirement
Master auto-confirm Client.

### Status
DONE

### Implemented
Seed: запись client1 → master1 подтверждается. UI записей мастера.

### UI
`/appointments`, dashboard pending widget.

### Backend
Booking confirm / auto-confirm policy.

### Test
Seed log `ok auto-confirm`.

### Known limitations
Не отдельный e2e «включить auto-confirm в UI» в этом прогоне.

---

## Requirement 10

### Original requirement
Salon Owner manages masters and schedules.

### Status
PARTIAL

### Implemented
`/staff`: список, invite по email (lookup, не UUID), disable. `/master` — профиль/салон. Календарь фильтры категорий.

### UI
`/staff`, `/master`, `/calendar`.

### Backend
org staff, contact-policy, schedules.

### Test
e2e `/staff` heading Команда + текст про контакты.

### Known limitations
Нет визуального staff-calendar «все мастера салона» с фильтром мастера как отдельный product screen. Invite требует уже зарегистрированный email.

---

## Requirement 11

### Original requirement
Business Calendar 2-like planner: blocks, colors, categories, drag/drop, flexible, role-aware.

### Status
PARTIAL

### Implemented
FullCalendar: Day/Week/Month/List, категории+цвета, hide chips, DnD, resize личных блоков, создание блока без UUID.

### UI
`/calendar`, виджет календаря на dashboard.

### Backend
appointments + planner blocks, reschedule validation.

### Test
e2e кнопки День/Неделя/Месяц/Список + «Новый блок».

### Known limitations
Не pixel-perfect BC2. Resize appointment откатывается. Конфликт — revert UI, но не отдельный e2e. Role palettes заданы, кастом цвета категории в UI ограничен.

---

## Requirement 12

### Original requirement
Master home: important notifications top, calendar, customizable widgets, layout, size.

### Status
PARTIAL

### Implemented
Dashboard: alerts/pending сверху, календарь, библиотека виджетов, small/medium/large/full, persist `/v1/me/dashboard`.

### UI
`/` для master.

### Backend
dashboard layout prefs.

### Test
e2e heading /Сегодня/.

### Known limitations
Нет drag-and-drop сетки. Часть виджетов-заглушки (tasks/deliveries).

---

## Requirement 13

### Original requirement
New user contextual hints.

### Status
PARTIAL

### Implemented
Компонент `Hint` (`?`), dismiss, Profile → «Показывать подсказки новичкам».

### UI
Dashboard, calendar, rep, shop (точечно).

### Backend
`GET/PATCH /v1/me/hints`.

### Test
Код + profile toggle. Нет e2e hints.

### Known limitations
Покрыты не все экраны. Нет тура/onboarding wizard.

---

## Requirement 14

### Original requirement
Structured service scheme: required free, optional premium/trial, full flow.

### Status
PARTIAL

### Implemented
При complete appointment — структурированные поля (не свободный textarea). Premium/trial может skip с причиной. Backend entitlement.

### UI
`/appointments/:id`.

### Backend
scheme get/save, plan check.

### Test
Код. Нет e2e complete→scheme в этом прогоне.

### Known limitations
Не все service categories имеют уникальные поля. Full FREE-flow не прогнан браузером на clean stack в этой итерации.

---

## Requirement 15

### Original requirement
Product audience all / professionals only; client marketplace; nearest salon pickup; manual override.

### Status
PARTIAL

### Implemented
Client `/shop`: только ALL. Pickup select, geolocation default если разрешена. Cart/qty/checkout. История заказов.

### UI
`/shop` (каталог / корзина / заказы).

### Backend
shop products audience filter, `pickup_branch_id` на client order.

### Test
API: Pro Fiber скрыт. e2e: heading Магазин + Каталог.

### Known limitations
Checkout e2e не гонял полный create order в UI. Related KB на detail — если API отдаёт.

---

## Requirement 16

### Original requirement
Salon Owner controls client contact visibility.

### Status
PARTIAL

### Implemented
Staff settings toggle. Backend не отдаёт phone/email мастеру при OFF.

### UI
`/staff` → «Показывать контактные данные клиентов мастерам».

### Test
e2e видимость toggle. Нет e2e «карточка без телефона».

### Known limitations
Нужен явный browser test OFF → master client card без phone/email.

---

## Requirement 17

### Original requirement
No-show protection: 2 no-show → master-local blacklist.

### Status
PARTIAL

### Implemented
Seed: client2 один no-show; client3 blacklist у master1. API blacklist status. UI unblock на карточке клиента (существовал).

### UI
Client card master.

### Backend
no-show count, local blacklist, booking block.

### Test
e2e API: `client3` `blocked=true`, `no_show_count>=2`.

### Known limitations
Полный UI-сценарий «client3 пытается записаться к master1 → blocked, к master B → ok, unblock» не прогнан Playwright как booking flow.

---

## Requirement 18

### Original requirement
Recurring supply: frequency, supplier approval, flexible management.

### Status
PARTIAL

### Implemented
Create: supplier, product, qty, weekly/biweekly/monthly, weekday, delivery window, start. Supplier: approve/reject/**propose**. Buyer: accept/reject proposal, pause/resume/cancel.

### UI
`/cosmetics/recurring`, `/supplier/recurring`.

### Backend
`decide` actions: approve, reject, propose, accept_proposal, reject_proposal. `proposed_change` JSONB.

### Test
e2e API: buyer видит seeded agreements.

### Known limitations
Нет `every N weeks` как отдельная frequency (CHECK: weekly/biweekly/monthly). Reconfirm при edit ключевых условий — через propose, не полный edit-form. Нет e2e propose.

---

## Requirement 19

### Original requirement
Subscription: Free, Premium, 3 months trial, complete product flow, no real acquiring.

### Status
PARTIAL

### Implemented
Новые master/supplier — trial. Страница план/срок/дни, Free vs Premium. Seed: free (master4), trial (master1), premium (supplier1), expired (expired1). DEV setter только в Vite DEV.

### UI
`/profile/subscription`, блок в профиле.

### Backend
`GET /v1/me/subscription`, entitlements, `ALLOW_DEV_BILLING`.

### Test
e2e snapshot + страница «Подписка».

### Known limitations
Нет эквайринга. Docker frontend — production build, DEV-кнопок нет (ожидаемо). Expired trial → Free проверен seed’ом, не отдельным UI e2e.

---

## P0 verification log

| Flow | Account | Steps | Expected | Actual |
|---|---|---|---|---|
| Supplier catalog | supplier1 | login → `/supplier/products` → analytics → warehouse | headings Товары / Аналитика / Склад | OK e2e 390+1920 |
| Knowledge | master1 | `/knowledge` → chip окрашивание → favorite | статья и кнопка избранного | OK e2e |
| Rep map | rep1 | `/rep` → `/rep/map` | кабинет + leaflet | OK e2e |
| Staff policy | master1 | `/staff` | Команда + «контактн» | OK e2e |
| Shop audience | client1 | GET shop products | нет Pro Fiber | OK API |
| Shop UI | client1 | `/shop` | Магазин + Каталог | OK e2e |
| Dashboard/calendar | master1 | `/` `/calendar` | Сегодня + режимы | OK e2e |
| Subscription | master1 | `/profile/subscription` | Подписка | OK e2e |
| Blacklist | client3/master1 | GET blacklist | blocked | OK API |
| Seed logins | all listed | `/v1/auth/login` | 200 | OK e2e |

---

## Out of scope (не добавлялось)

AI, mentorship, courses, coworking, новые маркетплейсы.

---

## Что остаётся до честного DONE по ТЗ 2–19

1. Browser e2e: no-show booking block + unblock; contact privacy hide phone; scheme complete FREE vs Premium.
2. Dashboard drag-grid; calendar conflict e2e; chain context на сервере.
3. Knowledge combobox-фильтры и editorial polish.
4. Recurring custom interval + propose e2e.
5. Representative GPS/provider и supplier drill-down performance.
6. Responsive ручной проход calendar/map/analytics на 430/768/1366 (e2e UI сценарии сейчас в основном 390).

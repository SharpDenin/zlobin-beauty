> Историческая приёмка UI (август 2026). Актуальные снимки: [docs/SCREENSHOTS.md](docs/SCREENSHOTS.md). Сценарий показа: [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md).

# UI_ACCEPTANCE.md — Salon-X

Дата проверки: **2026-08-18** (Phase 6).  
Стек: docker compose + seed. UI: `http://localhost:5173`. API: `http://localhost:8090`.  
Пароль seed: `Password123!`.

Playwright `frontend/e2e/salon-x.spec.ts`:
- Phase 6: contact privacy browser flow; blacklist locality+unblock; recurring every-N-weeks propose/accept/pause/revise/cancel; role cabinets; chain branch switcher; hints dismiss; auto-confirm + blacklist priority.
- Phase 5: Knowledge Hub search/filters/favorite/article/product reverse; supplier draft→preview→publish; API ownership + filter combo.
- Phase 4: free scheme complete, premium skip, expired subscription, registration trial.
- Phase 3: checkout e2e, multi-supplier API, cross-role pickup API, price-change UI, idempotency group.
- Phase 1–2 regression: phone-390 + laptop-1366.

| Screen | Role | Route | Purpose | Implemented | Responsive | Notes |
|---|---|---|---|---|---|---|
| Knowledge Home | Master | `/knowledge` | Editorial hub: search, chips from facets, sections | Yes | 390, 768, 1366, 1920 | URL query state, load more |
| Filter drawer | Master | `/knowledge` | Searchable multi-select Supplier/Brand/Product/Categories | Yes | 390 drawer, desktop panel | AND-комбинация на backend |
| Article Detail | Master | `/knowledge/:id` | Editorial column, media, related products | Yes | 390, 1366 | Lightbox image, HTML5 video |
| Supplier Editor | Supplier | `/knowledge/new`, `/knowledge/:id/edit` | CMS: cover, relations, TipTap, MediaDropzone insert | Yes | tablet/desktop | Draft / preview / publish / unpublish / archive |
| Preview | Supplier | editor → Предпросмотр | Same renderer as article | Yes | 1366 e2e | |
| Product ↔ Knowledge | Master / Client / Supplier | product detail | «Материалы и инструкции» | Yes | 390, 1366 | Cosmetics + Shop + supplier product edit |
| Subscription trial | Master | `/profile/subscription` | Premium Trial banner, days left | Yes | 390, 1366 | master1 |
| Subscription free | Master | `/profile/subscription` | Free + expired trial UX | Yes | 390, 1366 | expired1 |
| Subscription premium | Master | `/profile/subscription` | Paid Premium state | Yes | 390 | premium1 |
| Scheme editor | Master | `/appointments/:id` | Template fields, validation | Yes | 390, 1366 | coloring template |
| Scheme skip | Master | `/appointments/:id` | Premium skip confirm | Yes | 390 | premium1 |
| Client card scheme | Master | `/clients/id/:id` | Summary / withheld | Yes | 390, 1366 | VisitSchemeSummary |
| Client shop | Client | `/shop` | Каталог ≥12 товаров, фото, PROFESSIONAL_ONLY скрыт | Yes | 390, 1366 | Не UUID |
| Product detail | Client | `/shop/:id` | Галерея, add to cart, knowledge links | Yes | 390, 1366 | |
| Cart | Client | `/shop/cart` | Persistence, multi-supplier info | Yes | 390, 1366 | Auto-split at checkout |
| Checkout | Client | `/shop/checkout` | Pickup, payment, grouped summary | Yes | 390, 1366 | One UX → N supplier orders |
| Checkout success | Client | `/shop/checkout/success` | Group total + order numbers CL-* | Yes | 390 | |
| My orders | Client | `/orders` | History, reorder | Yes | 390, 1366 | client2 seeded states |
| Order detail | Client | `/orders/:id` | Timeline from status_history | Yes | 390 | |
| Salon pickup | Owner/admin/staff | `/pickup-orders` | Accept + handover | Yes | 390, 1366 | delivered → ready → received |
| Supplier client orders | Supplier | `/supplier/client-orders` | Confirm → delivery | Yes | 390 | |
| Notifications | Client | `/notifications` | Deep link to order | Yes | — | client_order entity |

## Phase 3 commerce architecture (acceptance)

- **One checkout UX** → `client_checkout_groups` + N `client_orders` (one per supplier).
- **Idempotency** on `(user_id, idempotency_key)` for the whole group.
- **Atomicity**: single DB transaction in `CreateCheckoutBatch` — group + all orders + stock reserve + cart clear; rollback on any failure.
- **Pickup**: rep `delivered` = at salon; salon accept → `ready_for_pickup`; handover → `received`.
- **Payment**: card must be authorized before handover; cash/bank at handover — not tied to delivery status alone.

## Accounts (Phase 3 walkthrough)

| Email | Use |
|---|---|
| `client1@demo.local` | Shop checkout demo |
| `client2@demo.local` | Order history (processing → received) |
| `master1@demo.local` | Salon pickup accept/handover |
| `supplier1@demo.local` / `supplier2@demo.local` | Supplier client orders (isolated) |
| `rep1@demo.local` | Rep delivery complete |

---

_Previous Phase 2 rows retained below._

| Screen | Role | Route | Purpose | Implemented | Responsive checked | Notes |
|---|---|---|---|---|---|---|
| Client home | Client `client1@demo.local` | `/` | Поиск мастера, ближайшая запись, переход в магазин | Yes | 390 (e2e shop nav) | Кабинет клиента, не мастерский dashboard |
| Client shop | Client | `/shop` | Каталог ALL, корзина, checkout pickup, история | Yes | 390 | PROFESSIONAL_ONLY скрыт API+каталогом. Checkout: салон самовывоза без UUID |
| Master dashboard | Master owner `master1` | `/` | Важное сверху, календарь, виджеты | Yes | 390, 1920 warehouse-related | Заголовок «Сегодня, …». Настройка виджетов: вкл/выкл и размер, не drag-grid |
| Master calendar | Master | `/calendar` | Day/Week/Month/List, блоки, DnD | Yes | 390 | FullCalendar. Resize записей откатывается; личные блоки можно растягивать |
| Master services | Master | `/services` | Прайс и услуги | Yes | not this run | Отдельный кабинет услуг, не owner-staff |
| Salon owner staff | Salon owner `master1` | `/staff` | Команда, invite, расписание сотрудника | Yes | 390, 1366 | Drawer «Расписание», не чужой кабинет |
| Salon settings / privacy | Owner | `/salon/settings` | Toggle контактов мастерам | Yes | 390, 1366 | Org-level policy; employee не видит phone/email |
| Chain owner | `chain1@demo.local` | `/` + calendar + staff | Server-side branches, KPI филиала | Yes | 390, 1366 | `chain-branch-switcher`; access по membership |
| Salon admin | `admin1@demo.local` | `/` | Операционный кабинет без owner-финансов | Yes | 390 | Нет Настройки/Аналитика/Подписка салона |
| Employee master | `employee1@demo.local` | `/` | Кабинет мастера салона + privacy | Yes | 390 | Нет Staff/Settings |
| Recurring supplies | Buyer / Supplier | `/cosmetics/recurring`, `/supplier/recurring` | N weeks, diff, pause, reconfirm | Yes | 390, 1366 | Было → Предложено |
| Client card blacklist | Master | `/clients/:id` | no-show count, unblock | Yes | 390, 1366 | POST unblock |
| Hints | New user | major screens | dismiss + global OFF | Yes | 390 | employee1 ON; premium1 OFF |
| Supplier dashboard | `supplier1@demo.local` | `/supplier` | Рабочий KPI dashboard после login | Yes | 390, 430, 768, 1366, 1920 | 8 KPI; на ≤700 только сегодня/заказы/оплата/доставки. Не каталог товаров |
| Supplier analytics | Supplier | `/supplier/analytics` | Период + Recharts | Yes | 390, 430, 768, 1366, 1920 | Сегодня/неделя/месяц/квартал/произвольный. Area/bar/pie, reps bar+table. Order+Payment |
| Supplier warehouse | Supplier / Rep | `/warehouse` | Остатки, фото, статус | Yes | 390 (e2e) | Rep: статусы без qty. Supplier: доступно · резерв · в пути + движения |
| Supplier team | Supplier | `/supplier/team` | Карточки представителей + мониторинг + задача | Yes | 390, 430, 768, 1366, 1920 | Имя/город/KPI, не UUID. Салон searchable. Типы задач. Detail `/supplier/team/:id` |
| Representative dashboard | `rep1@demo.local` | `/rep` | События, KPI, календарь, маршрут | Yes | 390, 430, 768, 1366, 1920 | Login → `/rep`. Planner Phase 1 (категории доставка/визит/задача/личное) |
| Representative route/map | Rep | `/rep/map` | Leaflet + polyline + stops | Yes | 390, 430, 768, 1366, 1920 | Карта ≤220px на 390. Side/list: салон, окно, к получению. «Рекомендованный маршрут» (haversine) |
| Representative finance | Rep | `/rep/finance` | День таблица + месяц chart | Yes | 390, 430, 768, 1366, 1920 | Payment model. Итого на день / получено за месяц |
| Representative analytics | Rep | `/rep/analytics` | Доставки, деньги, товары, задачи | Yes | 390, 430, 768, 1366, 1920 | Recharts, не div-графики |
| Knowledge hub | Master | `/knowledge` | Search, chips, sections, cards | Yes | 390, 1366 | Facets + URL filters + favorite on card |
| Knowledge editor | Supplier | `/knowledge/new` | TipTap, MediaDropzone at cursor, product search | Yes | 1366 | Draft / preview / publish |
| Subscription | Master | `/profile/subscription` | Trial/plan, сравнение, DEV controls | Yes | 390 | DEV-кнопки только `import.meta.env.DEV`. Docker production build их не показывает |

## Accounts for walkthrough

| Email | Cabinet |
|---|---|
| `client1@demo.local` | Client |
| `client2@demo.local` | Client, 1 no-show |
| `client3@demo.local` | Client, blacklist у master1 |
| `master1@demo.local` | Salon owner |
| `master2@demo.local` | Chair/renter |
| `master3@demo.local` | Salon employee |
| `master4@demo.local` | Private, Free |
| `mobile1@demo.local` | Mobile master |
| `chain1@demo.local` | Chain owner |
| `admin1@demo.local` | Salon administrator |
| `expired1@demo.local` | Expired trial → Free |
| `supplier1@demo.local` / `supplier2@demo.local` | Supplier |
| `rep1@demo.local` / `rep2@demo.local` | Supplier representative (Елена / Павел) |

## Known UI gaps (not DONE)

- Dashboard widgets: нет перетаскивания по сетке, только enable/size.
- Calendar DnD прошлых seed-записей может откатываться backend-валидацией (future-only reschedule).
- Chain owner: филиалы через localStorage, не серверный context.
- Recurring propose/accept есть в UI, отдельного e2e нет.
- Contact privacy: toggle проверен, скрытие phone/email на карточке — не отдельный browser e2e в этом прогоне.
- No-show: blacklist API для `client3` = blocked; UI «запись заблокирована» не гонялся как полный booking e2e.
- Маршрут: эвристика haversine, в UI явно «рекомендованный маршрут», не оптимальный.
- Полный `docker compose down -v` + reseed не гонялся в этом прогоне; seed идемпотентен для задач представителей.

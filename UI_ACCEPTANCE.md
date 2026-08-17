# UI_ACCEPTANCE.md — Salon-X

Дата проверки: **2026-08-17**.  
Стек: `docker compose down -v && docker compose up -d --build` + `docker compose --profile seed run --rm --build seed`.  
UI: `http://localhost:5173`. API: `http://localhost:8090`.  
Пароль всех seed-аккаунтов: `Password123!`.

Playwright P0 (`frontend/e2e/salon-x.spec.ts`): **39 passed**, viewport-skips only. Не skip из‑за отсутствия данных/логина.

Критерий `Implemented`: экран открывается под указанной ролью, без UUID в основном сценарии, назначение кабинета понятно. `Partial` — экран есть, но UX/покрытие неполное.

| Screen | Role | Route | Purpose | Implemented | Responsive checked | Notes |
|---|---|---|---|---|---|---|
| Client home | Client `client1@demo.local` | `/` | Поиск мастера, ближайшая запись, переход в магазин | Yes | 390 (e2e shop nav) | Кабинет клиента, не мастерский dashboard |
| Client shop | Client | `/shop` | Каталог ALL, корзина, checkout pickup, история | Yes | 390 | PROFESSIONAL_ONLY скрыт API+каталогом. Checkout: салон самовывоза без UUID |
| Master dashboard | Master owner `master1` | `/` | Важное сверху, календарь, виджеты | Yes | 390, 1920 warehouse-related | Заголовок «Сегодня, …». Настройка виджетов: вкл/выкл и размер, не drag-grid |
| Master calendar | Master | `/calendar` | Day/Week/Month/List, блоки, DnD | Yes | 390 | FullCalendar. Resize записей откатывается; личные блоки можно растягивать |
| Master services | Master | `/services` | Прайс и услуги | Yes | not this run | Отдельный кабинет услуг, не owner-staff |
| Salon owner staff | Salon owner `master1` | `/staff` | Команда, invite по email, политика контактов | Yes | 390 | Toggle «Показывать контактные данные клиентов мастерам» |
| Chain owner | `chain1@demo.local` | `/` + sidenav | Сеть, switcher филиала | Partial | not this run | Switcher в sidenav (localStorage). Нет отдельного экрана сети |
| Salon admin | `admin1@demo.local` | `/` | Операционный кабинет без owner-финансов | Partial | not this run | Nav без косметики/услуг owner; staff доступен |
| Supplier dashboard | `supplier1@demo.local` | `/supplier` | KPI кабинета поставщика | Partial | 390/1920 | Карточки оборота; полные графики на `/supplier/analytics` |
| Supplier analytics | Supplier | `/supplier/analytics` | KPI + charts + период | Yes | 390, 1920 | day/week/month/quarter + custom range. Источник Order+Payment |
| Supplier warehouse | Supplier / Rep | `/warehouse` | Остатки, фото, статус, search, движения | Yes | 390, 1920 | Rep: «Достаточный / Низкий / Нет в наличии». Supplier: available+reserved |
| Supplier team | Supplier | `/supplier/team` | Карточки представителей, задача/визит | Partial | not this run | Назначение по email, задача с салоном/датой/priority. KPI из analytics если есть user_id match |
| Representative dashboard | `rep1@demo.local` | `/rep` | Задачи, доставки, к получению | Yes | 390 | После логина редирект на `/rep` |
| Representative route/map | Rep | `/rep/map` | Карта OSM/Leaflet, stops, optimize | Yes | 390 | `.leaflet-container` в e2e. Provider haversine adapter |
| Representative finance | Rep | `/rep/finance` | К получению сегодня / месяц | Yes | not this run | Order+Payment, не Product.price |
| Knowledge hub | Master | `/knowledge` | Поиск, chips, секции, карточки | Partial | 390 | Фильтры+избранное e2e. Не полноценный editorial hub на всех данных |
| Knowledge editor | Supplier | `/knowledge` | TipTap, inline media, товары чекбоксами | Yes | not this run | Не JSON textarea |
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
| `rep1@demo.local` / `rep2@demo.local` | Supplier representative |

## Known UI gaps (not DONE)

- Dashboard widgets: нет перетаскивания по сетке, только enable/size.
- Calendar DnD прошлых seed-записей может откатываться backend-валидацией (future-only reschedule).
- Chain owner: филиалы через localStorage, не серверный context.
- Knowledge: нет searchable multi-select поставщик/товар как отдельный combobox; chips + dropdown категории/бренд.
- Recurring propose/accept есть в UI, отдельного e2e нет.
- Contact privacy: toggle проверен, скрытие phone/email на карточке — не отдельный browser e2e в этом прогоне.
- No-show: blacklist API для `client3` = blocked; UI «запись заблокирована» не гонялся как полный booking e2e.

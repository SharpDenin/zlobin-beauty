# REQUIREMENTS_ACCEPTANCE.md — Salon-X Phase 6

Дата: **2026-08-18**.  
Стек: docker compose + seed. UI: `http://localhost:5173`. API: `http://localhost:8090`.  
Пароль demo: `Password123!`.

Правило статуса: **DONE** только если есть backend, permissions, UI, seed, browser flow, responsive, automated acceptance и runtime check. API-only = PARTIAL.

Допустимые non-blocking limitations: нет боевого эквайринга; production routing может оставаться adapter; AI не входит в 1–19.

---

## Requirement 1

### Original requirement
Название продукта — Salon-X (не внутренние package names).

### Status
DONE

### UI
Бренд в shell, login, client home, topbar. Любой экран после входа.

### Backend
Не требуется.

### Permissions
—

### Seed
Любой demo-аккаунт.

### Automated Acceptance
`e2e/salon-x.spec.ts` login / visual brand.

### Manual Acceptance
Открыть UI — заголовок Salon-X.

### Limitations
Внутренние Go paths остаются `zlobin-beauty`.

---

## Requirement 2

### Original requirement
Knowledge Base: связи с товаром/категорией, фильтры, ranking, рекомендации, избранное, rich media, production UX.

### Status
DONE

### UI
`/knowledge`, `/knowledge/:id`, `/knowledge/new`, `/knowledge/:id/edit`.

### Backend
FTS + ILIKE, facets, ranking, ownership, draft/publish.

### Permissions
Чтение опубликованного; редактирование только своей организации-поставщика.

### Seed
Статьи supplier1 с product links.

### Automated Acceptance
`master knowledge hub search filters favorite article`; `supplier knowledge editor draft preview publish`; `phase5 knowledge filter combination and ownership`.

### Manual Acceptance
master1 → База знаний → поиск/chips → статья. supplier1 → создать материал.

### Limitations
Поиск PostgreSQL, не Elasticsearch. Нет клиентского knowledge hub.

---

## Requirement 3

### Original requirement
Избранное в базе знаний.

### Status
DONE

### UI
Кнопка избранного на карточке/детали, chip «Избранное».

### Backend
`POST/DELETE /v1/knowledge/{id}/favorite`, `?favorites=1`.

### Permissions
Авторизованный пользователь.

### Seed
Статьи supplier1.

### Automated Acceptance
Favorite click в hub e2e + API favorites filter.

### Manual Acceptance
Открыть статью → избранное → фильтр.

### Limitations
Нет отдельной страницы «только избранное» кроме фильтра.

---

## Requirement 4

### Original requirement
Статья поставщика связана с товаром и категорией.

### Status
DONE

### UI
Редактор: категория + searchable товары. Карточка товара: «Материалы и инструкции».

### Backend
`product_ids`, `category` на статье; reverse product→knowledge.

### Permissions
Можно привязать только свои товары (чужой product_id → 400/403).

### Seed
Knowledge seed с product links.

### Automated Acceptance
Phase 5 editor + ownership attach foreign product.

### Manual Acceptance
supplier1 редактор → товары; master1 карточка косметики → статьи.

### Limitations
Нет отдельной витрины «категория → все статьи» как marketplace.

---

## Requirement 5

### Original requirement
Склад поставщика: карточки товара, статусы, фото.

### Status
DONE

### UI
`/warehouse` — карточки, available/reserved, движения. Rep: человеческие статусы.

### Backend
`GET /v1/commerce/stock`, movements.

### Permissions
Supplier / representative своей организации.

### Seed
Остатки supplier1.

### Automated Acceptance
`supplier products + analytics + warehouse`.

### Manual Acceptance
supplier1 → Склад.

### Limitations
Не отдельный WMS. Фото зависят от `photo_media_id`.

---

## Requirement 6

### Original requirement
Кабинет представителя: склад, карта маршрута, оптимизация, визиты, задачи, мониторинг, инкассация, аналитика.

### Status
DONE

### UI
`/rep`, `/rep/map`, `/rep/finance`, `/rep/analytics`. Supplier team monitoring.

### Backend
routes/stops, rep analytics, tasks, deliveries.

### Permissions
`supplier_rep`; supplier видит своих представителей.

### Seed
`rep1@demo.local`, `rep2@demo.local`, маршрут.

### Automated Acceptance
`representative route and tasks`; `phase2 representative dashboard map finance analytics`.

### Manual Acceptance
rep1 → Сегодня / Карта / Деньги.

### Limitations
Optimize — haversine adapter, не production routing provider. Координаты seed, не живой GPS.

---

## Requirement 7

### Original requirement
Простые карточки товаров и услуг (фото, цена, наличие), без UUID.

### Status
DONE

### UI
Shop/product cards; `/services` карточки услуг.

### Backend
Commerce products, services catalog.

### Permissions
Розница клиенту; professional — салону.

### Seed
Каталоги supplier1/2, услуги мастеров.

### Automated Acceptance
`client shop catalog is in navigation`; `phase3 client shop checkout end-to-end`.

### Manual Acceptance
client1 магазин; master1 услуги.

### Limitations
—

---

## Requirement 8

### Original requirement
Отдельные кабинеты: Client, типы мастеров, Owner, Chain Owner, Admin, Supplier, Rep.

### Status
DONE

### UI
`cabinet.tsx` nav по роли/`work_type`. Запрещённые пункты скрыты; URL `/staff`, `/reports`, `/salon/settings` отсекаются `RequireCabinetFeature`.

### Backend
JWT roles + memberships + `work_type`. Reports — только owner. Contact policy — только owner.

### Seed
private `master4`, renter `master2`, employee `employee1`, mobile `mobile1`, owner `master1`, chain `chain1`, admin `admin1`, supplier, rep, client.

### Automated Acceptance
`phase6 role cabinets show expected nav`.

### Manual Acceptance
Логин каждого seed-аккаунта → свой label кабинета и nav.

### Limitations
Экраны календаря/клиентов общие, различие в nav и permissions, не отдельные приложения.

---

## Requirement 9

### Original requirement
Мастер включает автоподтверждение для конкретного клиента.

### Status
DONE

### UI
Карточка клиента → «Автоподтверждение для этого клиента». После записи: «подтверждена автоматически».

### Backend
`PUT /v1/me/clients/{id}/auto-confirm`. Blacklist проверяется до auto-confirm.

### Permissions
Только master↔client пара.

### Seed
client1 ↔ master1 auto-confirm после complete.

### Automated Acceptance
`phase6 auto-confirm confirms one client and blacklist still blocks`.

### Manual Acceptance
master1 → карточка client2 → включить → client2 записывается (confirmed). Другой клиент — pending.

### Limitations
—

---

## Requirement 10

### Original requirement
Владелец салона управляет мастерами и их графиками.

### Status
DONE

### UI
`/staff` → Расписание (часы, выходной) без входа в чужой кабинет. `/salon/settings` — политика контактов.

### Backend
`PUT /v1/calendar/working-hours?organization_id=&master_user_id=`; exceptions; 409 если записи вне новых часов; 403 чужой салон.

### Permissions
Owner/admin своей организации.

### Seed
Anna staff: owner, admin1, employee1.

### Automated Acceptance
`salon owner staff + contact policy`; staff schedule drawer.

### Manual Acceptance
master1 → Команда → Расписание сотрудника.

### Limitations
Invite только уже зарегистрированного пользователя по email.

---

## Requirement 11

### Original requirement
Бизнес-календарь: блоки, категории, цвета, DnD, роли.

### Status
DONE

### UI
`/calendar` Day/Week/Month/List, категории, DnD личных блоков, филиал/мастер для owner.

### Backend
Planner blocks + appointments, overlap 409.

### Permissions
Master свои блоки; owner/admin org calendar.

### Seed
Обед / e2e planner block.

### Automated Acceptance
`master dashboard and calendar modes`; `calendar planner block is clickable and editable`; occupancy 409.

### Manual Acceptance
master1 календарь: создать событие, перенести, удалить.

### Limitations
Не pixel-perfect копия стороннего BC2. Resize записи откатывается.

---

## Requirement 12

### Original requirement
Главная мастера: важное сверху, календарь, настраиваемые виджеты.

### Status
DONE

### UI
`/` dashboard, библиотека виджетов, persist layout.

### Backend
`GET/PUT /v1/me/dashboard`.

### Permissions
Master / admin / owner.

### Seed
Любой мастер.

### Automated Acceptance
`dashboard widget toggle survives reload`; `dashboard PUT/GET round-trip`.

### Manual Acceptance
master1 → Сегодня → Настроить.

### Limitations
—

---

## Requirement 13

### Original requirement
Контекстные подсказки для нового пользователя; dismiss; глобальный выключатель.

### Status
DONE

### UI
`Hint` на dashboard, calendar, staff, privacy, services, client card, shop, cosmetics, recurring, warehouse, products, reps, booking. Профиль: «Подсказки интерфейса».

### Backend
`GET/PATCH /v1/me/hints` (enabled + dismissed keys).

### Permissions
Свои prefs.

### Seed
Новые пользователи ON. `premium1` hints OFF.

### Automated Acceptance
`phase6 hints dismiss persists and global off hides them`.

### Manual Acceptance
employee1 → `?` на Сегодня → Больше не показывать → reload. Профиль OFF.

### Limitations
Нет пошагового wizard-тура, только contextual `?`.

---

## Requirement 14

### Original requirement
Структурированная схема услуги (окрашивание и т.д.), обязательна на Free, skip на Premium.

### Status
DONE

### UI
`/appointments/:id` scheme form; карточка клиента — summary.

### Backend
Scheme templates, skip только premium.

### Permissions
Master своей записи.

### Seed
Phase 4 appointments: free / premium / expired.

### Automated Acceptance
`phase4 free master must fill scheme to complete`; `phase4 premium master can skip scheme`.

### Manual Acceptance
См. MANUAL_DEMO § Subscription + Scheme.

### Limitations
—

---

## Requirement 15

### Original requirement
Аудитория товара + клиентский магазин; professional скрыт от клиента.

### Status
DONE

### UI
`/shop` каталог, cart, checkout pickup. PROFESSIONAL_ONLY не в клиентском каталоге.

### Backend
Audience filter; checkout groups.

### Permissions
Client shop ≠ salon cosmetics.

### Seed
Розница + Pro Fiber.

### Automated Acceptance
`professional-only hidden from client shop API`; phase3 checkout e2e.

### Manual Acceptance
client1 магазин; master1 косметика.

### Limitations
Эквайринг демо/не боевой.

---

## Requirement 16

### Original requirement
Владелец салона решает, видят ли мастера контакты клиентов Salon-X.

### Status
DONE

### UI
`/salon/settings` toggle «Показывать контактные данные клиентов мастерам». Карточка: «Контакты скрыты политикой салона».

### Backend
`organizations.masters_see_client_contacts` (salon/org level, без branch override). `ApplyContactPolicy` затирает phone/email в JSON. Owner/admin видят. Чужой салон 403.

### Permissions
PATCH policy — owner only. Redaction — masters без owner/admin membership.

### Seed
`employee1` сотрудник салона Анны + визит client1.

### Automated Acceptance
`phase6 contact privacy owner toggle hides contacts from employee`.

### Manual Acceptance
master1 OFF → employee1 карточка без телефона → ON → контакты видны.

### Limitations
Политика на уровне организации, не филиала.

---

## Requirement 17

### Original requirement
После 2 no-show к одному мастеру — blacklist именно этого мастера; unblock; не глобальный.

### Status
DONE

### UI
Карточка: счётчик, статус, «Разблокировать клиента». Клиент при записи: «Запись к этому мастеру сейчас недоступна.»

### Backend
Только статус `no_show` (cancel/reject не считаются). После 2 — `master_client_blacklist`. Unblock не стирает историю. Приоритет над auto-confirm.

### Permissions
Master своей пары; client booking reject 403.

### Seed
client2 — 1 no-show; client3 — blacklist master1.

### Automated Acceptance
`phase6 blacklist two no-shows then unblock locality`; seeded client3 API block.

### Manual Acceptance
2× Неявка master A → запись A блокируется, B доступна → разблокировать → A снова доступна.

### Limitations
—

---

## Requirement 18

### Original requirement
Регулярные поставки: частота (в т.ч. каждые N недель), согласование, pause/cancel, rolling horizon.

### Status
DONE

### UI
`/cosmetics/recurring`, `/supplier/recurring`: N недель, несколько товаров, филиал, окно, diff «Было → Предложено», pause/resume/revise/cancel, exceptions.

### Backend
`every_n_weeks` + `interval_weeks` 1–12, `end_date`, propose/revise, reject восстанавливает previous status, generate на rolling horizon.

### Permissions
Buyer create/revise/pause; supplier approve/propose/pause.

### Seed
Weekly approved agreement + e2e создаёт every 3 weeks.

### Automated Acceptance
`phase6 recurring every 3 weeks propose accept pause revise cancel`; `seeded recurring supply is visible to buyer`.

### Manual Acceptance
См. MANUAL_DEMO кратко: заявка → предложение → принять.

### Limitations
Окно доставки хранится и используется как minute offset генерации, не отдельный routing slot.

---

## Requirement 19

### Original requirement
Подписка: trial 3 месяца Premium, затем Free; paid Premium.

### Status
DONE

### UI
`/profile/subscription` trial/free/premium. Admin салона не видит owner subscription link.

### Backend
`/v1/me/subscription`.

### Permissions
Свой snapshot.

### Seed
master1 trial, master4 free, premium1 paid, expired1 expired.

### Automated Acceptance
`subscription page shows trial or plan`; `phase4 expired trial subscription shows free`; `phase4 registration grants calendar trial`.

### Manual Acceptance
Три аккаунта на экране Подписка.

### Limitations
Нет боевого эквайринга / автопродления карты.

---

## Phase 6 extras (не отдельные исходные 1–19, но закрывают gaps)

| Тема | UI | Test |
|---|---|---|
| Chain Owner server-side branches | sidenav/dashboard `chain-branch-switcher`, calendar/staff filter | `phase6 chain owner branch switcher changes staff context` |
| Salon Admin operational cabinet | nav без finance/settings | `salon admin lands on operational dashboard`; roles test |
| Cross-salon 403 | GetCard / hours | privacy foreign 403 |

---

## PHASE 6 BLOCKERS

**NONE** (2026-08-23).

Phase 6 privacy, blacklist, recurring, role cabinets, chain branches, salon admin, hints, auto-confirm — closed with targeted Playwright + seed. Full regression baseline: 53 passed (`phone-390` + `laptop-1366`) before Phase 6; Phase 6 tests green after fixes.

Runtime re-verification on clean deploy: see `FINAL_ACCEPTANCE.md`.

Допустимые residual limitations (не blockers): эквайринг, routing adapter, отсутствие AI.

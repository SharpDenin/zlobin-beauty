# MANUAL_DEMO.md — Salon-X (15–20 минут)

Практический сценарий встречи. Пароль всех demo-аккаунтов: **`Password123!`**.

Перед показом (demo/staging only):

```bash
docker compose down -v    # УДАЛЯЕТ pgdata + miniodata — только для reset demo
docker compose up -d --build
curl -fsS http://127.0.0.1:8090/healthz
docker compose --profile seed run --rm --build seed
```

UI: `http://localhost:5173` (или `PUBLIC_APP_URL` на сервере).  
Viewports для проверки: **390 / 768 / 1366+**.

Не создавать данные на сцене — seed уже содержит нужные состояния.

---

## Demo accounts (quick reference)

| Role | Email | State / purpose |
|------|-------|-----------------|
| Salon Owner | `master1@demo.local` | Trial, Krasnoyarsk, staff, privacy |
| Client | `client1@demo.local` | Auto-confirm, shop |
| Client | `client3@demo.local` | Blacklisted by master1 |
| Renter | `master2@demo.local` | Novosibirsk |
| Employee | `employee1@demo.local` | Contacts hidden when owner toggles OFF |
| Salon Admin | `admin1@demo.local` | Operational dashboard |
| Chain Owner | `chain1@demo.local` | 2 branches |
| Private Free | `master4@demo.local` | Scheme required |
| Premium | `premium1@demo.local` | Scheme skip |
| Supplier | `supplier1@demo.local` | Warehouse, analytics, KB |
| Representative | `rep1@demo.local` | Route map, finance |

---

## 1. Master — Dashboard + Calendar (~3 мин)

**Account:** `master1@demo.local`  
**Route:** Login → `/` (Сегодня)

| Step | Action | Expected | Say / note |
|------|--------|----------|------------|
| 1 | Login | Landing «Сегодня», бренд Salon-X | «Кабинет владельца салона» |
| 2 | Обратить внимание на виджеты | KPI, записи, важное | Drag layout optional |
| 3 | **Календарь** в nav | День / Неделя / Список | |
| 4 | DnD запись или категории | Перетаскивание работает | Desktop; mobile — список |
| 5 | **Команда** | Список сотрудников | Переход к staff |

---

## 2. Client Booking (~2 мин)

**Account:** `client1@demo.local`  
**Route:** `/search`

| Step | Action | Expected | Say / note |
|------|--------|----------|------------|
| 1 | Город **Красноярск** | Мастера в списке | |
| 2 | Выбрать **Анну** (master1) | Профиль, услуги | |
| 3 | Услуга → слот → Записаться | **Confirmed** сразу | Auto-confirm с master1 |
| 4 | (Optional) `client2` | Pending flow | Конtrast, не обязательно |

---

## 3. Client Shop (~3 мин)

**Account:** `client1@demo.local`  
**Route:** `/shop`

| Step | Action | Expected | Say / note |
|------|--------|----------|------------|
| 1 | **Магазин** | Каталог товаров | B2B cosmetics for masters |
| 2 | Открыть товар | Цена, фото, описание | |
| 3 | В корзину | Cart badge updates | |
| 4 | Checkout | Pickup **филиал** (имя, не UUID) | |
| 5 | Оформить | Заказ в **Заказы** | Mock payment |

---

## 4. Supplier (~2 мин)

**Account:** `supplier1@demo.local`  
**Route:** `/` → analytics

| Step | Action | Expected | Say / note |
|------|--------|----------|------------|
| 1 | Dashboard | KPI cards | |
| 2 | **Аналитика** | Charts / summary | |
| 3 | **Склад** | Stock levels | Warehouse page |

---

## 5. Representative (~2 мин)

**Account:** `rep1@demo.local`  
**Route:** `/rep/route`

| Step | Action | Expected | Say / note |
|------|--------|----------|------------|
| 1 | Dashboard | Tasks summary | |
| 2 | **Маршрут** | Leaflet map, stops | «Recommended route» heuristic |
| 3 | **Деньги** | Finance view | |

---

## 6. Knowledge (~3 мин)

**Master:** `master1@demo.local` → `/knowledge`

| Step | Action | Expected |
|------|--------|----------|
| 1 | Filters / chips | Faceted list |
| 2 | Избранное | Favorite toggle |
| 3 | Open article | Rich content, related products |

**Supplier (30 sec):** `supplier1@demo.local` → KB editor → preview/publish.

---

## 7. Subscription + Scheme (~2 мин)

| Account | Route | Expected |
|---------|-------|----------|
| `master1@demo.local` | `/profile/subscription` | Trial Premium |
| `master4@demo.local` | Complete visit | Scheme **required** |
| `premium1@demo.local` | Complete visit | Scheme **skip** |

Show trial on master1 only if time; master4/premium1 optional backup screens.

---

## 8. Owner / Safety (~2 min)

**Privacy:** `master1` → **Настройки** → contacts OFF → logout → `employee1` → **Клиенты** → no phone → owner ON → phone visible.

**Blacklist (brief):** `client3` cannot book master1; can book master2. Owner can unblock in client card.

**Recurring (brief):** `master1` → `/cosmetics/recurring` — seeded weekly agreement or show every-N-weeks from acceptance.

**Chain (10 sec):** `chain1@demo.local` — branch switcher Krasnoyarsk / Novosibirsk.

**Admin (10 sec):** `admin1@demo.local` — operational «Сегодня», no owner finance/settings.

---

## Demo reset (staging only)

```bash
docker compose down -v
docker compose up -d --build
docker compose --profile seed run --rm --build seed
```

**Warning:** destroys all demo data in volumes.

---

## If something fails

1. `curl -fsS http://127.0.0.1:8090/healthz`
2. `docker compose ps` — all healthy
3. Re-run seed (idempotent)
4. Browser hard refresh / incognito

See `SERVER_DEPLOY_CHECKLIST.md` for server deployment.

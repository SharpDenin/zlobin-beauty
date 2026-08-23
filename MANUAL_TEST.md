# MANUAL_TEST.md — приёмочные сценарии Salon-X

Дата: **2026-08-15**

Предусловия:

```bash
docker compose down -v
docker compose up -d --build
curl -fsS http://127.0.0.1:8090/healthz
docker compose --profile seed run --rm --build seed
```

| Что | URL |
|-----|-----|
| Frontend | http://localhost:5173 |
| API | http://localhost:8090 |
| Health | http://localhost:8090/healthz |

Пароль demo: **`Password123!`**

При `/healthz` ≠ 200 — не тестируйте бизнес-сценарии.
При здоровом API отсутствие seed/аккаунта = **FAIL** (не «пропуск»).

Viewports: 390 / 768 / 1366+.

---

## T1. Логин ролей

| | |
|--|--|
| **Accounts** | `client1@demo.local`, `master1@demo.local`, `supplier1@demo.local`, `rep1@demo.local` |
| **URL** | /login |
| **Expected** | Уход с `/login`, роль-специфичный home, нет белого экрана |

---

## T2. Поиск + flexible booking

| | |
|--|--|
| **Account** | `client2@demo.local` |
| **Actions** | /search → Красноярск → Анна → Стрижка → дата будня → слот → запись |
| **Expected** | Успешное создание записи |

---

## T3. Fixed-window capacity > 1

| | |
|--|--|
| **Account** | `client1@demo.local` |
| **Actions** | Анна → мастер-класс → occurrence «мест: N» (N≥1, seed capacity=3) |
| **Expected** | Выбор окна; повторные записи не ломаются unique-index на occurrence |

---

## T4. Pickup без UUID

| | |
|--|--|
| **Account** | `master1@demo.local` |
| **Actions** | /cosmetics → поставщик → в корзину → филиал получения |
| **Expected** | Человекочитаемые филиалы; нет полей UUID |

---

## T5. Knowledge Base

| | |
|--|--|
| **Account** | `master1` / `supplier1` |
| **Actions** | Фильтр Колористика, избранное; supplier: cover + video + product_ids |
| **Expected** | Rich `doc_json`, медиа, сортировка/фильтры работают |

---

## T6. Delivery SoT

| | |
|--|--|
| **Account** | `supplier1@demo.local` |
| **Actions** | /supplier/orders → confirmed → picking → ready_for_dispatch → schedule → preparing → in-transit → … |
| **Expected** | Физика только через Delivery; нет кнопок order-status `in_transit`/`delivered` |

---

## T7. Rep

| | |
|--|--|
| **Account** | `rep1@demo.local` |
| **URL** | /rep |
| **Expected** | Задачи, кнопка маршрута, список доставок |

---

## T8. Staff + contacts + blacklist

| | |
|--|--|
| **Account** | `master1@demo.local` |
| **Actions** | /staff политика контактов; карточка клиента → разблокировка; calendar → блок |
| **Expected** | Сохранение политики; unblock API 200; блок в таймлайне дня |

---

## T9. Recurring + subscription + audience

| | |
|--|--|
| **Actions** | /cosmetics/recurring создать; supplier approve; /profile subscription; client shop без Pro Fiber |
| **Expected** | E2E регулярных поставок; snapshot подписки; audience filter |

---

## T10. Timezone input

| | |
|--|--|
| **Actions** | Services → создать occurrence `datetime-local` при TZ филиала ≠ TZ браузера |
| **Expected** | Инстант в UTC соответствует wall time салона (`Asia/Krasnoyarsk` для demo Анны) |

---

## Автотесты

```bash
cd frontend
npx playwright test e2e/demo-mvp.spec.ts e2e/salon-x.spec.ts
npm test -- --run src/shared/lib/time.test.ts
```

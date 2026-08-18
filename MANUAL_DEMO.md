# MANUAL_DEMO.md — Salon-X (≈15–20 минут)

Перед показом:

```bash
docker compose down -v
docker compose up -d --build
curl -fsS http://127.0.0.1:8090/healthz
docker compose --profile seed run --rm --build seed
```

UI: `http://localhost:5173` (или публичный URL из README_DEPLOY).
Пароль demo: **`Password123!`**

Проверьте viewports: **390 / 768 / 1366+**.

---

## 1. Клиент (2 мин)

`client1@demo.local` — поиск (Красноярск), запись к Анне; fixed_window МК с `мест: N` (capacity > 1).

## 2. База знаний (3 мин)

`master1@demo.local` → **База знаний**: фильтр «Колористика», избранное, статья с cover / inline image / video / связанными товарами.

`supplier1@demo.local` → новая статья: перетащите обложку, вставьте видео в редакторе, отметьте связанные товары галочками из своего каталога.

## 3. Склад, заказы, Delivery SoT (3 мин)

Поставщик → **Товары** / **Склад** / **Аналитика**.
**Заказы**: коммерческие статусы до `ready_for_dispatch`; физика только через Delivery (preparing → in_transit → arrived → delivered). Legacy order `in_transit`/`delivered` из UI не переводятся.

## 4. Представитель (3 мин)

`supplier1` → **Представители**.  
`rep1@demo.local` → задачи (Готово), **Построить рекомендованный маршрут**, доставки.

## 5. Владелец и администратор салона (2 мин)

`master1` → **Команда**: политика контактов, приглашение сотрудника по email, отключение.
**Календарь**: событие планера создать / открыть / изменить название и цвет / удалить. Переключение филиала у сети меняет часовой пояс и записи.
`admin1@demo.local` попадает на операционный dashboard («Сегодня»), а не в клиентский поиск.

## 6. Регулярные поставки / подписка / pickup (3 мин)

`master1` → `/cosmetics/recurring` — заявка.
`supplier1` → `/supplier/recurring` — approve.
Профиль: subscription / trial.
Checkout косметики: филиал получения выбирается из списка салонов, без ручного ввода идентификаторов.

## 8. Client Shop / Commerce (Phase 3, 5 мин)

`client1@demo.local` → **Магазин** → товар → **Корзина** → **Оформить** → самовывоз (рекомендованный салон) → оплата → сводка (несколько поставщиков — один checkout) → **Готово** → **Мои заказы** → детали + timeline.

Multi-supplier: добавьте товар S1-* и S2-* — после checkout два заказа CL-*.

## 9. Pickup chain (заранее seeded, 2 мин)

`client2@demo.local` → **Мои заказы** — статусы processing / in delivery / ready for pickup / received.

Живой cross-role (acceptance test, не обязательно на сцене):
`supplier1` → **Заказы клиентов** → confirm → delivery → `rep1` → complete → `master1` → **Выдача заказов** → принять → выдать.

---

После демо: `FINAL_REPORT.md` → **PHASE 3 BLOCKERS: NONE**.

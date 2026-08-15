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

`master1@demo.local` → **База знаний**: фильтр «Колористика», избранное, статья с cover / inline image / video / product links.

`supplier1@demo.local` → новая статья: dropzone обложки, video в редакторе, UUID товаров.

## 3. Склад, заказы, Delivery SoT (3 мин)

Поставщик → **Товары** / **Склад** / **Аналитика**.
**Заказы**: коммерческие статусы до `ready_for_dispatch`; физика только через Delivery (preparing → in_transit → arrived → delivered). Legacy order `in_transit`/`delivered` из UI не переводятся.

## 4. Представитель (3 мин)

`supplier1` → **Представители**.  
`rep1@demo.local` → задачи (Готово), **Построить рекомендованный маршрут**, доставки.

## 5. Владелец салона (2 мин)

`master1` → **Команда**: политика контактов, приглашение по user_id, отключение.
**Календарь**: блок планера create/move/delete.
Карточка клиента: разблокировка после no-show blacklist.

## 6. Регулярные поставки / подписка / pickup (3 мин)

`master1` → `/cosmetics/recurring` — заявка.
`supplier1` → `/supplier/recurring` — approve.
Профиль: subscription / trial.
Checkout косметики: филиал получения без UUID.

## 7. Audience (1 мин)

Товар Pro Fiber не виден клиенту в shop API; виден мастеру/поставщику.

---

После демо: сверьте `FINAL_REPORT.md` → **BLOCKERS BEFORE SERVER DEMO** должен быть пустым.

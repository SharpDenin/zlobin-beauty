# MANUAL_DEMO.md — Salon-X (≈15–20 минут)

Перед показом:

```bash
docker compose down -v
docker compose up -d --build
curl -fsS http://127.0.0.1:8090/healthz
docker compose --profile seed run --rm --build seed
```

UI: `http://localhost:5173`. Пароль: **`Password123!`**. Viewports: **390 / 768 / 1366+**.

Не создавать сущности на встрече — seed уже содержит нужные состояния.

---

## 1. Master Dashboard + Calendar (3 мин)

`master1@demo.local` — **Сегодня**: виджеты, DnD, календарь. **Календарь**: День/Неделя/Список, личное событие, категории.

## 2. Client Booking (2 мин)

`client1@demo.local` — поиск Красноярск → Анна → слот. Auto-confirm: запись сразу confirmed.  
`client2` без auto-confirm — pending (если показывать контраст).

## 3. Client Shop (2 мин)

`client1` → **Магазин** → товар → корзина → самовывоз (имя филиала, не UUID) → заказ.

## 4. Supplier Dashboard / Analytics (2 мин)

`supplier1@demo.local` → Главная KPI, **Товары**, **Склад**, **Аналитика**.

## 5. Representative Map (2 мин)

`rep1@demo.local` → **Маршрут** → карта Leaflet, рекомендованный маршрут, **Деньги**.

## 6. Knowledge Hub (2 мин)

`master1` → База знаний: поиск, chips, статья. Коротко: `supplier1` редактор.

## 7. Subscription + Scheme (2 мин)

`master1` → Профиль → Подписка (trial).  
Не обязательно на сцене: `master4` scheme required / `premium1` skip (уже в acceptance).

## 8. Owner Staff / Privacy (2 мин)

`master1` → **Команда** → Расписание сотрудника. **Настройки** → контакты мастерам OFF.  
`employee1@demo.local` → Клиенты → карточка без телефона. Owner ON — контакты возвращаются.

## 9. Blacklist / Recurring (кратко, 2 мин)

Blacklist: `client3@demo.local` не записывается к Анне, записывается к Ивану (`master2`). Карточка у Анны — разблокировать.  
Recurring: `master1` `/cosmetics/recurring` (есть weekly seed) или показать every N weeks из acceptance.

`chain1@demo.local` — переключатель филиала (Красноярск / Новосибирск).  
`admin1@demo.local` — операционный «Сегодня», без настроек владельца.

---

После закрытия Phase 6: `REQUIREMENTS_ACCEPTANCE.md`. Финальный server deploy — только после **PHASE 6 BLOCKERS: NONE**.

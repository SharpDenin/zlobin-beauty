# MANUAL_TEST.md — приёмочные сценарии

Дата: **2026-08-10**

Предусловия:

```bash
docker compose up -d --build
docker compose --profile seed run --rm seed
```

| Что | URL |
|-----|-----|
| Frontend | http://localhost:5173 |
| API gateway | http://localhost:8090 |
| Health | http://localhost:8090/healthz |

Пароль всех demo-аккаунтов: **`Password123!`**

Для каждого сценария: выполните шаги и сравните с колонкой Expected.  
При падении API (`/healthz` ≠ 200) сценарии записи/заказов пропускайте до подъёма стека.

---

## T1. Логин ролей

| | |
|--|--|
| **Account** | по очереди: `client1@demo.local`, `master1@demo.local`, `supplier1@demo.local` |
| **URL** | http://localhost:5173/login |
| **Actions** | Email + пароль → **Войти** |
| **Expected** | Уход с `/login`. Client: поиск/записи. Master: записи/кабинет/косметика. Supplier: товары/заказы. Нет traceback/белого экрана. |

---

## T2. Поиск: город по умолчанию Красноярск

| | |
|--|--|
| **Account** | `client1@demo.local` (city=Красноярск после seed) |
| **URL** | http://localhost:5173/search |
| **Actions** | Открыть поиск. Не меняя город, нажать **Искать**. |
| **Expected** | Поле «Город» = `Красноярск`. В списке **Анна Колористика** и/или **Дмитрий Бровист**. Нет **Иван Стилист** (Новосибирск). Бейджи города — Красноярск. |

---

## T3. Поиск: другие города → Новосибирск

| | |
|--|--|
| **Account** | `client1@demo.local` |
| **URL** | http://localhost:5173/search |
| **Actions** | Включить **«Показывать мастеров из других городов»** → **Искать**. |
| **Expected** | Появляется **Иван Стилист**, город **Новосибирск** (бейдж «другого города»). Красноярские мастера тоже могут остаться в выдаче. |

---

## T4. Гибкая запись (flexible)

| | |
|--|--|
| **Account** | `client2@demo.local` |
| **URL** | поиск → карточка Анны → wizard |
| **Actions** | Город Красноярск → Искать → **Анна Колористика** → услуга **Стрижка** (режим «Гибкая запись») → будний день → свободный слот → подтвердить. |
| **Expected** | Слоты с учётом 60 мин. Confirmation state (не сырой JSON). В **Мои записи** статус «ожидает подтверждения» или сразу подтверждена (если auto-confirm). |

---

## T5. Fixed-window (мастер-класс)

| | |
|--|--|
| **Account** | `client1@demo.local` |
| **URL** | карточка Анны |
| **Actions** | Выбрать **«Авторский мастер-класс по окрашиванию»** (Фиксированное окно) → список сеансов `.occurrence-card` → выбрать → подтвердить (если есть свободные места). |
| **Expected** | Видны сеансы с временем в timezone (`Asia/Krasnoyarsk` / dual time) и «мест: N». Пустой empty-state допустим, если occurrence уже забронирован/отменён. Не показывается выбор произвольного слота как у flexible. |

---

## T6. Мастер: подтверждение / календарь

| | |
|--|--|
| **Account** | `master1@demo.local` |
| **URL** | `/appointments`, `/calendar` |
| **Actions** | Найти заявку client2 → **Подтвердить** (если pending). Открыть календарь на дату. |
| **Expected** | Русский статус «Подтверждена». Запись видна в календаре дня/недели. |

---

## T7. Услуги и расписание мастера

| | |
|--|--|
| **Account** | `master1@demo.local` |
| **URL** | `/services`, кабинет |
| **Actions** | Открыть услуги: flexible + fixed_window МК. При желании добавить occurrence или изменить working hours. |
| **Expected** | Карточки услуг с ценой/длительностью/режимом. Fixed: список occurrences. Слоты клиента реагируют на day-off / часы. |

---

## T8. Клиентская карточка и auto-confirm

| | |
|--|--|
| **Account** | `master1@demo.local` затем `client1@demo.local` |
| **URL** | `/clients` → карточка; затем запись клиентом |
| **Actions** | Проверить историю/формулу. Для client1↔master1 seed включает auto-confirm — создать новую flexible-запись. |
| **Expected** | Формула читаема (не raw-only JSON). Новая запись client1 к master1 сразу **confirmed**. |

---

## T9. Косметика: каталог без UUID

| | |
|--|--|
| **Account** | `master1@demo.local` |
| **URL** | http://localhost:5173/cosmetics |
| **Actions** | Открыть список поставщиков → **Поставщик Профи**. |
| **Expected** | Карточки с названием/городом/доставкой. **Нет** поля UUID / `supplier_org_id`. Товары: бренд, цена, for_sale. |

---

## T10. Checkout: филиал получения + оплата

| | |
|--|--|
| **Account** | `master1@demo.local` |
| **URL** | каталог поставщика → корзина |
| **Actions** | Добавить товар → блок **Филиал получения** → поиск/выбор филиала салона (Красноярск центр) → способ оплаты (наличные/перевод/карта/счёт) → **Подтвердить заказ**. |
| **Expected** | Выбор по имени/адресу, не UUID. Для карты — hint про будущую онлайн-оплату. Заказ в **Мои заказы**, статус Новый; видны способ оплаты и филиал получения. |

---

## T11. Поставщик: заказ, доставка, mark-paid

| | |
|--|--|
| **Account** | `supplier1@demo.local` |
| **URL** | `/supplier/orders` (или раздел заказов поставщика) |
| **Actions** | Открыть заказ мастера → провести commercial transitions по UI → **Запланировать доставку** (дата) → сменить delivery status. При необходимости **отметить оплаченным** (`mark-paid`). |
| **Expected** | Русские кнопки/статусы. Destination показан как имя филиала. Payment status → paid после mark-paid. **Нет** реального эквайринга. |

---

## T12. Товар поставщика

| | |
|--|--|
| **Account** | `supplier1@demo.local` |
| **URL** | товары → редактирование |
| **Actions** | Изменить цену / снять с продажи / сохранить. Опционально загрузить фото (MediaDropzone). |
| **Expected** | Карточка сохраняется. Master в каталоге видит обновление (published+for_sale). |

---

## T13. База знаний: список и статья

| | |
|--|--|
| **Account** | `master1@demo.local` |
| **URL** | `/knowledge` → `/knowledge/{id}` |
| **Actions** | Открыть список → клик по статье. |
| **Expected** | Список с заголовками. Статья: H1, автор/дата, body (plain или rich). Cover/badge если есть. Нет «Статья не найдена». |

---

## T14. Supplier knowledge create (rich)

| | |
|--|--|
| **Account** | `supplier1@demo.local` |
| **URL** | `/knowledge` |
| **Actions** | Создать материал (rich editor), категория/бренд, опубликовать. Войти master1 → увидеть статью. |
| **Expected** | Статья в published-ленте мастера. Формат `doc_json` в UI редактора. |

---

## T15. Типы мастеров

| Account | Expected work framing |
|---------|------------------------|
| `master1@demo.local` | owner, Красноярск |
| `master2@demo.local` | renter, Новосибирск |
| `master3@demo.local` | employee, Москва |
| `master4@demo.local` | independent, Красноярск |

**Actions:** кабинет/профиль. **Expected:** человекочитаемый формат работы, город/TZ соответствуют seed.

---

## T16. Permissions

| | |
|--|--|
| **Account** | `client2@demo.local` |
| **URL** | попытка `/cosmetics`, `/supplier/products`, `/warehouse` |
| **Actions** | Прямой заход по URL. |
| **Expected** | Client не видит master/supplier разделы в nav. Прямой URL — redirect/ошибка доступа, не данные чужой роли. |

---

## T17. Mobile ~390×844

| | |
|--|--|
| **Account** | `client2@demo.local` / `master1@demo.local` |
| **URL** | DevTools device mode |
| **Actions** | Login → поиск → карточка → wizard; master bottom nav / «Ещё». |
| **Expected** | Нет горизонтального overflow. CTA и bottomnav кликабельны. |

---

## T18. Health / seed smoke (API)

| | |
|--|--|
| **Account** | — |
| **URL** | http://localhost:8090/healthz |
| **Actions** | GET healthz. Опционально login master1 → `GET /v1/suppliers`, `GET /v1/masters?city=Красноярск`. |
| **Expected** | 200. Suppliers массив. Masters: Анна/Дмитрий; с `include_other_cities=true` — Иван. |

---

## Критерии «готово к демо»

- [ ] T2–T3 multi-city search  
- [ ] T4 flexible book  
- [ ] T5 fixed UI (или осознанный empty-state)  
- [ ] T10 pickup checkout без UUID  
- [ ] T13 knowledge article  
- [ ] T11 delivery/payment manual path  

Автоматический минимум: `cd frontend && npm run test:e2e -- e2e/demo-mvp.spec.ts --project=phone-390` при живом API+seed.

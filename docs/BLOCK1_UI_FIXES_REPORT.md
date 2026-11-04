# Блок 1 — UI fixes, Services API, Messenger, Push, Menu Assets

**Дата:** 2026-11-04  
**Среда проверки:** local Docker `127.0.0.1:5173` + seed

---

## 1. Мобильные уведомления слева

### Первопричина
`NotificationBubbles` рендерил до 3 полноценных карточек (`width: min(320px, 100vw-24px)`) с `position: fixed` поверх home. На телефоне стек закрывал контент, CTA и пересекался с blur/stacking context atmospheric home.

### Что исправлено
- **&lt;768:** компактные круглые индикаторы **40×40**, **строго вертикальный столбик слева** (`left: max(10px, safe-area-inset-left)`, `top: safe-area + 56px`), `flex-direction: column`, gap 6px. Без горизонтальной рейки и без правого угла.
- Тап открывает карточку **справа от столбика** (rail 40px → panel from ~58px); hide/delete/API без изменений.
- **≥768:** прежние карточки (`notif-bubbles--desktop`); на ≥1024 — слева как раньше.

### Файлы
- `frontend/src/features/notifications/NotificationBubbles.tsx`
- `frontend/src/features/notifications/notification-bubbles.css`
- `frontend/src/features/notifications/NotificationBubbles.test.tsx`
- `frontend/src/shared/ui/AppIcon.tsx` (`bell`)

### Тесты / проверка
- Vitest: 3/3 PASS (compact expand + hide/delete, desktop cards).
- **390px:** left=10, rail `column`, 3×40px dots, height 132; panel opens at left=58. Скриншоты: `docs/qa01-artifacts/notif-bubbles-390-column.png`, `notif-bubbles-390-left.png` (с открытой карточкой).
- **360px:** left=10, compact column 40×132. Скриншот: `docs/qa01-artifacts/notif-bubbles-360-left.png`.
- **768px:** `notif-bubbles--desktop`, 3 cards, 0 dots.

### Ограничения
Физический iPhone/Samsung safe-area — ручная проверка.

---

## 2. Push / VAPID

### Первопричина
`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` в env контейнера `communications` были **пустыми**. Сервис стартовал с логом `web push disabled…`, `GET /v1/push/config` → `{ enabled: false }` — UI честно показывал «Push на сервере пока выключен». Код пути (config → subscribe → async send → prune 410) был корректным.

### Исправлено в коде
Нет обязательных дефектов кода; документация уже описывала генерацию.

### Настроено в dev
1. Ключи: `npx web-push generate-vapid-keys`
2. Записаны в **gitignored** `.env` (private key не в git / не в отчёте).
3. `docker compose up -d --force-recreate communications`
4. Лог: `web push enabled`
5. `GET /v1/push/config` → `enabled: true` + public_key
6. `PUT` / `DELETE /v1/push/subscription` — OK
7. UI настроек: кнопка «Включить» (сообщение о выключенном сервере исчезло)

### Требует production secrets / оператора
```bash
npx web-push generate-vapid-keys
# Записать в production secret store (не в git):
# VAPID_PUBLIC_KEY=...
# VAPID_PRIVATE_KEY=...
# VAPID_SUBJECT=mailto:no-reply@your-domain
docker compose up -d --force-recreate communications
# Проверка: GET /v1/push/config → enabled:true
```

### Требует физической проверки
Включение push в браузере/PWA, системный баннер при новом уведомлении, click → deep link: **iPhone (установленная PWA)** и **Samsung/Chrome**. Автотесты не заменяют доставку FCM/APNs Web Push.

---

## 3. Создание услуги — `invalid json body`

### Первопричина
`httpx.DecodeJSON` использует `DisallowUnknownFields()`. Frontend отправлял `published` в `POST /v1/services`, а `createServiceReq` поля `published` не имел → decoder → `invalid json body`.

### Что исправлено
- Backend: `published *bool` в create DTO + `CreateServiceInput`; default `true`, если не передано.
- Понятные сообщения decode: `unknown field: …` через `httpx.DecodeJSONMessage`.

### Файлы
- `backend/services/marketplace/internal/httpapi/httpapi.go`
- `backend/services/marketplace/internal/service/service.go`
- `backend/shared/httpx/httpx.go`
- `backend/shared/httpx/decode_json_message_test.go`

### Тесты / проверка
- `go test ./backend/shared/httpx` — PASS  
- `go test ./backend/services/marketplace/internal/service` — PASS  
- Live API: create с `published:true` и `published:false` → 201, услуги в ответе.

### Ограничения
Полный UI-прогон формы (все optional + reload) желателен на стенде после деплоя образа `marketplace` (уже пересобран локально).

---

## 4. Мессенджер — изображения и composer

### Первопричина
- У `<img>` внутри `.chat-media-image` не было собственных лимитов; кнопка не клиповала overflow → картинка визуально наезжала на текст.
- Bubble не был flex-column; composer — «квадратные» отдельные кнопки/textarea без единой pill-оболочки.

### Что исправлено
- Bubble: `display:flex; flex-direction:column; gap; overflow:hidden`.
- Текст **перед** медиа в потоке; media `max-width:100%`, `max-height:240px`, `object-fit:contain`, overflow hidden.
- Composer: скруглённая оболочка 22px, attach/send — круглые иконки (`AppIcon` attach/send), textarea без собственной рамки, focus-within на row.
- Lightbox без изменений API.

### Файлы
- `frontend/src/shared/ui/styles.css`
- `frontend/src/features/messenger/MessengerApp.tsx`
- `frontend/src/shared/ui/AppIcon.tsx`

### Тесты
- `MessengerApp.test.tsx` — 10/10 PASS.

### Ограничения
Сетка нескольких изображений в одном сообщении подготовлена CSS-классом `.chat-media-grid`; API по-прежнему одно `media_id` на сообщение.

---

## 5. Пункты меню — иконки

### Первопричина / аудит
Nav/sidenav/bottomnav/more уже используют **единый** stroke-набор `AppIcon` + `NavIcon` (Lucide-compatible outlines), не AI PNG. В `public/` нет нейросетевых иконок меню — только logo, PWA icons и atmospheric backgrounds (дизайн-система home).

### Что сделано
- Расширен `AppIcon`: `bell`, `attach`, `send`.
- Уточнён `NavIcon` mapping (`consultations`→clipboard, `notifications`→bell, chairs/pickup/orders).
- Owner tiles по-прежнему `AppIcon` — без второй иконной библиотеки.

### Файлы
- `frontend/src/shared/ui/AppIcon.tsx`
- `frontend/src/shared/ui/NavIcon.tsx`

### Ограничения
Атмосферные фото фона home (`forest-water.jpg` и т.п.) **не** заменялись — это не пункты меню.

---

## Команды (dev)

```bash
# VAPID (уже применено локально в .env)
npx web-push generate-vapid-keys
# → .env (gitignored)
docker compose up -d --force-recreate communications

# После правок backend/frontend
docker compose up -d --build marketplace frontend
```

## Сводка статусов

| Направление | Код | Dev-настройка | Prod secrets | Физ. устройства |
|---|---|---|---|---|
| Mobile notif | исправлено | — | — | желательно |
| Push | путь ок | VAPID в `.env` + recreate communications | да, отдельные ключи | да (iPhone/Samsung) |
| Services JSON | исправлено | marketplace rebuild | деплой образа | — |
| Messenger | исправлено | frontend rebuild | деплой | желательно |
| Menu icons | аудит + донастройка AppIcon | — | — | — |

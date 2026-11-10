# Web Push (PUSH-01)

Salon-X доставляет **системные** Web Push поверх уже существующих in-app уведомлений. Адресация и ACL не меняются: push уходит тому же `user_id`, для которого создана запись в `notifications`.

## Архитектура

1. Событие приложения (booking, messenger, commerce, …) создаёт уведомление через `POST /v1/internal/notifications` или внутренний `CreateNotification`.
2. Communications сохраняет in-app уведомление (unread / лента / bubbles без изменений).
3. Затем **асинхронно** отправляет Web Push на все активные `push_subscriptions` этого пользователя
   (`TTL=86400`, `Urgency=high` — сообщение ждёт офлайн-устройство до суток).
4. Ошибка push **не** откатывает и не блокирует in-app уведомление.
5. Ответы `404` / `410` от push-сервиса удаляют подписку устройства.
6. UI показывает «включено» **только** после успешного `PUT /v1/push/subscription`.
   Локальная подписка браузера без строки в БД = состояние «нужно подтвердить» (кнопка «Включить»).

Таблица `push_subscriptions` (миграция `005_push_subscriptions.sql`) уже существовала — схема не менялась.

## API

| Method | Path | Auth | Назначение |
| --- | --- | --- | --- |
| GET | `/v1/push/config` | Bearer | `{ enabled, public_key }` |
| PUT | `/v1/push/subscription` | Bearer | сохранить/обновить подписку текущего пользователя |
| DELETE | `/v1/push/subscription` | Bearer | удалить подписку текущего пользователя по `endpoint` |

Подписка всегда привязана к `claims.UserID`. Чужие endpoint удалить нельзя.

## VAPID

| Переменная | Где | Описание |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY` | communications (+ FE через config API) | публичный ключ |
| `VAPID_PRIVATE_KEY` | только communications | приватный ключ, никогда во frontend / логи |
| `VAPID_SUBJECT` | communications | email контакта (`ops@…`) или `https://…`. Префикс `mailto:` допустим и нормализуется — библиотека `webpush-go` сама добавляет `mailto:` |

Без ключей сервис **стартует**; push просто выключен (`enabled: false`). Один и тот же key pair должен использоваться всеми инстансами communications.

### Генерация ключей

```bash
npx web-push generate-vapid-keys
```

Запишите оба ключа в production `.env` (не в git):

```env
VAPID_PUBLIC_KEY=<public>
VAPID_PRIVATE_KEY=<private>
VAPID_SUBJECT=no-reply@salon-x.ru
```

Перезапустите `communications` (после деплоя фикса `normalizeVAPIDSubject`):

```bash
docker compose up -d --build --force-recreate communications
```

В логах: `web push enabled` или предупреждение `web push disabled…`. Приватный ключ в логах не печатается.

### Известный дефект (исправлен)

Если `VAPID_SUBJECT` задан как `mailto:…`, старые сборки передавали это значение в `webpush-go` как есть. Библиотека снова добавляла `mailto:`, и JWT claim `sub` становился `mailto:mailto:…`. Push-провайдеры (FCM и др.) отклоняли доставку; подписка при этом сохранялась, in-app уведомления работали. Communications теперь снимает лишний `mailto:` перед отправкой.

После деплоя фикса пользователям со **сменёнными** VAPID-ключами нужно снова нажать «Включить» (FE пересоздаёт подписку при смене public key).

## Frontend UX

- **Настройки → Уведомления** (`/settings/notifications`) — для всех ролей.
- Карточка также на экране **Уведомления** и на старте владельца салона.
- Системное разрешение запрашивается **только** по кнопке «Включить».
- Состояния: не поддерживается / сервер выключен / denied / выключено / включено.
- «Отключить» снимает подписку в браузере и на backend.
- При уже выданном разрешении выполняется тихая синхронизация подписки на backend.

Service worker (`sw-push.js`, подключается через Workbox `importScripts`):

- `push` → `showNotification` (title/body/url, fallback Salon-X);
- `notificationclick` → focus существующей вкладки origin или `openWindow`, затем переход на `url` из payload.

## Диагностика

| Симптом | Проверка |
| --- | --- |
| `enabled: false` | `VAPID_*` в env communications |
| Кнопка «Включить» → denied | настройки сайта/ОС |
| Нет системного баннера | PWA/HTTPS, SW зарегистрирован, **строка в `push_subscriptions`**, логи `push dispatch finished` / `push skipped: no subscriptions` |
| UI «включено», но баннера нет | раньше UI мог врать по локальной подписке; нужна успешная синхронизация на сервер |
| `push skipped: no subscriptions` | пользователь не завершил «Включить» или PUT не дошёл до communications |
| `push delivery rejected` http 401/403 | VAPID public/private mismatch или битый subject (до фикса — double mailto); смотри `provider_body` |
| 410 после ротации ключей | пользователю нужно включить push снова (старые подписки невалидны) |
| Баннер только если приложение открыто | проверьте, что задеплоен communications с `TTL≥3600` (раньше TTL=60с дропал офлайн-доставку) |

## Ручная проверка устройств

Автотесты не заменяют реальный Web Push.

1. **Production-like HTTPS** или localhost, установленная PWA где требуется.
2. Войти любым тестовым аккаунтом → Настройки → Уведомления → Включить.
3. Вызвать событие, которое создаёт уведомление другому пользователю (сообщение, запись и т.п.).
4. Проверить баннер при открытом приложении и при закрытом (свернутом) приложении.
5. Тап по уведомлению → нужный экран.
6. Отключить push → событие только в ленте, без системного баннера.

### Платформы (ожидания)

| Устройство | Ожидание |
| --- | --- |
| iPhone + установленная PWA (поддерживаемый iOS) | Web Push после Add to Home Screen |
| Samsung / Android Chrome + PWA или вкладка | обычно работает |
| Desktop Chrome/Edge | обычно работает |
| Браузеры без PushManager | UI показывает «не поддерживает» |

Не утверждать одинаковое поведение на всех ОС без проверки на конкретном устройстве.

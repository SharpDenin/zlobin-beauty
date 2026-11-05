# AUTH-01–03: почта, подтверждение email и политика сессий

## Продуктовые решения

- Восстановление пароля — по email.
- Подтверждение email реализовано; **не** является hard-gate для входа, записи или покупки.
- Подтверждение телефона через SMS **отложено** до выбора SMS-провайдера. Поле `phone_verified` сохранено для совместимости; SMS-отправка и фиктивные коды не подключены.
- Remember me не реализуется.
- После успешного сброса пароля отзываются **все** сессии пользователя.
- Изменение `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` влияет только на **новые** токены; массового отзыва старых refresh нет.

## Почтовая инфраструктура

Бизнес-логика identity зависит только от интерфейса `backend/shared/mailer.Mailer`.

| Компонент | Назначение |
| --- | --- |
| `Mailer` | `Ready()` + `Send(ctx, Message)` |
| SMTP-адаптер | REG.RU и любой совместимый SMTP |
| `Noop` | нет `SMTP_PASSWORD` / провайдер `noop` — процесс стартует, письма не уходят |
| `Mock` | автотесты |

Переменные (см. `.env.example`):

- `EMAIL_PROVIDER` (`smtp` \| `noop`)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_TLS_MODE`
- `EMAIL_FROM`, `EMAIL_FROM_NAME`
- `PUBLIC_APP_URL` — база ссылок в письмах (`/reset-password`, `/verify-email`)

Секреты только из env. Пароль не пишется в исходники, миграции, Dockerfile, логи, фикстуры.

Если `SMTP_PASSWORD` пуст, identity логирует предупреждение и стартует. Анонимный reset возвращает тот же нейтральный ack; authenticated resend verify возвращает конфликт «email delivery is not configured».

Начальные значения REG.RU: host `smtp.salon-x.ru`, port `465`, TLS `implicit`, from `no-reply@salon-x.ru`.

Смена провайдера: новый адаптер за `Mailer` + конфиг. Auth endpoints не трогать.

Полный runbook: [EMAIL_RUNBOOK.md](./EMAIL_RUNBOOK.md).

## AUTH-01 — восстановление пароля

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/v1/auth/password-reset/request` | нет |
| POST | `/v1/auth/password-reset/confirm` | нет |

- Одноразовый токен ≥ 32 байт энтропии; в БД только SHA-256 hash (`auth_action_tokens`, purpose `password_reset`).
- TTL 45 минут (в окне 30–60).
- Новая выдача инвалидирует предыдущий активный токен.
- Новый пароль — Argon2id; затем `RevokeSessionsForUser`.
- Ответ request одинаков для известного и неизвестного email.
- Rate limit: identity (email/account hash + IP) и gateway.

## AUTH-02 — подтверждение email

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/v1/auth/email-verification/request` | Bearer |
| POST | `/v1/auth/email-verification/confirm` | нет |

- Использует существующее `users.email_verified`.
- Токены в `auth_action_tokens` (purpose `email_verify`), TTL 24 часа.
- UI профиля: мягкий статус + «Отправить письмо ещё раз»; без блокировок сценариев.

## AUTH-03 — политика сессий (зафиксировано)

| Параметр | Значение |
| --- | --- |
| Access TTL | 15 минут (`ACCESS_TOKEN_TTL`, default `15m`) |
| Refresh TTL | 30 дней (`REFRESH_TOKEN_TTL`, default `720h`) |
| Access | JWT HS256 |
| Refresh | opaque ≥ 32 байт, SHA-256 в БД |
| Rotation | при каждом refresh |
| Grace | 20 секунд (multi-tab / single-flight) |
| Reuse | вне grace — revoke family |
| Frontend | localStorage + auto-refresh + multi-tab sync |
| Logout | отзыв текущей сессии |

См. также [adr/002-auth-tokens.md](./adr/002-auth-tokens.md).

## Миграции identity

1. Существующие `001`…`005`
2. **`006_auth_action_tokens.sql`** — таблица одноразовых токенов

Rollback: `DROP TABLE IF EXISTS auth_action_tokens;`

Массовый UPDATE `email_verified` / `phone_verified` не выполняется.

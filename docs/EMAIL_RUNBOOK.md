# Runbook: почта Salon-X (REG.RU → другой провайдер)

Пароль ящика `no-reply@salon-x.ru` задаёт **владелец проекта** самостоятельно. Этот документ не содержит секретов.

## 1. Создание почтового ящика REG.RU

1. В панели REG.RU для домена `salon-x.ru` создайте ящик `no-reply@salon-x.ru`.
2. Задайте сложный пароль и сохраните его в секрет-хранилище (не в git).
3. Убедитесь, что SMTP для домена включён.

## 2. Параметры SMTP (текущий провайдер)

| Параметр | Значение |
| --- | --- |
| Host | `smtp.salon-x.ru` |
| Port | `465` |
| TLS | implicit SSL/TLS (`SMTP_TLS_MODE=implicit`) |
| TLS server name | `hosting.reg.ru` (`SMTP_TLS_SERVER_NAME`) — сертификат REG.RU на `*.hosting.reg.ru`, не на `smtp.salon-x.ru` |
| Username | `no-reply@salon-x.ru` |
| From | `no-reply@salon-x.ru` |
| From name | `Salon-X` |

## 3. Production `.env` (identity / compose)

Добавьте (пароль — ваш, не из репозитория):

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.salon-x.ru
SMTP_PORT=465
SMTP_USERNAME=no-reply@salon-x.ru
SMTP_PASSWORD=<задайте-сами>
SMTP_TLS_MODE=implicit
SMTP_TLS_SERVER_NAME=hosting.reg.ru
EMAIL_FROM=no-reply@salon-x.ru
EMAIL_FROM_NAME=Salon-X
PUBLIC_APP_URL=https://<ваш-публичный-origin>
```

Не коммитьте заполненный production `.env`.

## 4. Перезапуск

После изменения env перезапустите сервис **identity** (и gateway при необходимости), например:

```bash
docker compose up -d --force-recreate identity
```

В логах identity при старте:

- без пароля: предупреждение `mailer not configured…`
- с паролем: `mailer ready` (host без пароля)

## 5. Проверка тестового письма

1. Войдите тестовым пользователем.
2. Профиль → «Отправить письмо ещё раз» (подтверждение email) **или**
3. `/forgot-password` с email существующего аккаунта.
4. Письмо должно прийти от `no-reply@salon-x.ru` со ссылкой на `PUBLIC_APP_URL`.

Без `SMTP_PASSWORD` reset анонимно всегда отвечает нейтрально (письмо не уходит); resend verify для авторизованного пользователя вернёт ошибку конфигурации.

## 6. Проверка восстановления пароля

1. Запросите ссылку → откройте из письма → задайте новый пароль.
2. Старый пароль не работает; все прежние сессии отозваны.
3. Войдите с новым паролем.

## 7. Проверка подтверждения email

1. Запросите письмо из профиля.
2. Откройте `/verify-email?token=…`.
3. В профиле статус «Email подтверждён».
4. Убедитесь, что до подтверждения вход / запись / магазин доступны.

## 8. Диагностика SMTP

| Симптом | Что проверить |
| --- | --- |
| `mailer not configured` | `SMTP_PASSWORD`, `SMTP_HOST`, `EMAIL_FROM` |
| Таймаут / dial error | firewall, host, port 465, TLS mode |
| Auth failed | username/password ящика |
| Письмо в спаме | SPF/DKIM/DMARC домена |
| Ссылка ведёт не туда | `PUBLIC_APP_URL` |

Не логируйте `SMTP_PASSWORD` и raw-токены из писем.

## 9. Смена SMTP-провайдера без смены бизнес-логики

1. Реализуйте новый адаптер под `mailer.Mailer` (или используйте SMTP-совместимый endpoint).
2. Подключите выбор в `mailer.New` по `EMAIL_PROVIDER`.
3. Обновите только env (host/port/user/password/TLS/from).
4. Перезапустите identity.
5. Endpoints `/v1/auth/password-reset/*` и `/v1/auth/email-verification/*` менять не нужно.

Телефон / SMS в этом runbook не настраиваются — провайдер ещё не выбран.

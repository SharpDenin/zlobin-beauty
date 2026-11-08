# Production runbook — Auth, Email, Push

Практическая инструкция для оператора Salon-X. Опирается на фактический код и шаблоны `.env.example` / `.env.production.example` / `docker-compose.yml`.

**Секреты и реальные ключи в этот файл не входят.**  
**Настройка production `.env` и restart сервисов — действия оператора; этот документ их не выполняет.**

Смежные источники (не дублировать дословно):

| Тема | Документ |
| --- | --- |
| Выкат Compose / HTTPS / CORS | [DEPLOYMENT.md](./DEPLOYMENT.md) |
| Auth / сессии / SMTP-архитектура | [AUTH_EMAIL_AND_SESSIONS.md](./AUTH_EMAIL_AND_SESSIONS.md), [adr/002-auth-tokens.md](./adr/002-auth-tokens.md) |
| REG.RU SMTP пошагово | [EMAIL_RUNBOOK.md](./EMAIL_RUNBOOK.md) |
| Web Push | [PUSH.md](./PUSH.md) |
| Безопасность / секреты | [SECURITY.md](./SECURITY.md) |
| PWA / SW | [PWA.md](./PWA.md) |

---

## 1. Что уже реализовано в коде vs что делает оператор

| Область | Уже в коде | Делает оператор |
| --- | --- | --- |
| Login / refresh / logout | JWT + opaque refresh, rotation, grace 20s | Задать `JWT_SECRET`, TTL при необходимости |
| Password reset / email verify | Endpoints + `auth_action_tokens` | Завести SMTP-ящик, DNS, `SMTP_*`, `PUBLIC_APP_URL` |
| Сессии на клиенте | `localStorage` (`zb.auth`), auto-refresh, multi-tab | HTTPS, корректный origin |
| Cookie auth | **не используется** | — |
| Web Push | API + async send + prune 404/410 | Сгенерировать VAPID, прописать env, проверить на устройствах |
| Rate limits gateway | Defaults в production жёстче | Опционально `RATE_LIMIT_*`, `TRUST_PROXY_HEADERS` |

---

## 2. Production-переменные (сверка с кодом / compose)

Значения — только примеры имён и назначения. Получение: `openssl rand -hex 32`, панель REG.RU, `npx web-push generate-vapid-keys`.

### 2.1 Обязательные для боевого контура

| Переменная | Назначение | Где | Перезапуск |
| --- | --- | --- | --- |
| `APP_ENV=production` | Production-режим (CORS `*` запрещён, rate limits жёстче) | все сервисы / `.env` | весь стек |
| `JWT_SECRET` | Подпись/проверка access JWT (HS256) | gateway + все backend-сервисы | все сервисы с JWT |
| `INTERNAL_TOKEN` | S2S internal API | identity, orgs, booking, clients, commerce, communications, media | затронутые сервисы |
| `POSTGRES_PASSWORD` | Пароль Postgres | postgres | postgres (+ зависимые) |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | Учётки MinIO | minio / media | minio, media |
| `CORS_ORIGINS` | Точные browser origin (не `*`) | gateway (+ сервисы в compose) | gateway |
| `PUBLIC_APP_URL` | База ссылок в письмах (`/reset-password`, `/verify-email`) | **identity** | identity |
| `VITE_API_BASE_URL` | Bake-in API base при сборке SPA | **frontend build** | пересборка frontend |
| `ALLOW_DEV_BILLING=false` | Выключить dev billing | identity | identity |
| `ALLOW_SEED=false` | Запрет seed на бою | seed profile | — |

`JWT_SECRET` / `INTERNAL_TOKEN` без значения → сервисы **не стартуют** (`panic`).

Frontend: для same-origin (nginx SPA + `/v1/` → gateway) оставьте `VITE_API_BASE_URL` **пустым** при `docker compose build frontend`. Vite **отказывается** собирать production, если в URL есть `localhost` / `127.0.0.1` ([SECURITY.md](./SECURITY.md)).

### 2.2 Email / SMTP (обязательны для реальной доставки писем)

| Переменная | Назначение | Обязательность | Где | Перезапуск |
| --- | --- | --- | --- | --- |
| `EMAIL_PROVIDER` | `smtp` или `noop` | рекомендуется `smtp` | identity | identity |
| `SMTP_HOST` | SMTP host | нужна для отправки | identity | identity |
| `SMTP_PORT` | порт (default 465) | нужна | identity | identity |
| `SMTP_USERNAME` | логин ящика | нужна | identity | identity |
| `SMTP_PASSWORD` | пароль ящика | **обязателен для отправки**; без него mailer Noop | identity | identity |
| `SMTP_TLS_MODE` | `implicit` (default) | нужна для REG.RU:465 | identity | identity |
| `SMTP_TLS_SERVER_NAME` | SNI/verify name (`hosting.reg.ru` для REG.RU) | **нужна** для текущего REG.RU SMTP | identity | identity |
| `EMAIL_FROM` | From address | нужна (fallback = username) | identity | identity |
| `EMAIL_FROM_NAME` | From display name | рекомендуется | identity | identity |

Без `SMTP_PASSWORD` identity **стартует**, в логе: `mailer not configured…`. Reset анонимно отвечает нейтрально без письма; resend verify для авторизованного пользователя — ошибка конфигурации.

Текущие значения REG.RU из шаблонов (не секрет): host `smtp.salon-x.ru`, port `465`, username/from `no-reply@salon-x.ru`, `SMTP_TLS_SERVER_NAME=hosting.reg.ru`.

### 2.3 Сессии (рекомендуемые defaults уже в коде)

| Переменная | Default | Назначение | Где | Перезапуск |
| --- | --- | --- | --- | --- |
| `ACCESS_TOKEN_TTL` | `15m` | TTL access JWT | identity | identity |
| `REFRESH_TOKEN_TTL` | `720h` (30 дней) | TTL refresh | identity | identity |

Меняет только **новые** токены. Массового отзыва старых refresh при смене TTL нет.

### 2.4 Web Push (опционально; без ключей in-app уведомления работают)

| Переменная | Назначение | Обязательность | Где | Перезапуск |
| --- | --- | --- | --- | --- |
| `VAPID_PUBLIC_KEY` | публичный VAPID | оба ключа нужны для `enabled: true` | **communications** | communications |
| `VAPID_PRIVATE_KEY` | приватный VAPID (**только backend**, не FE, не логи) | см. выше | communications | communications |
| `VAPID_SUBJECT` | email (`ops@…`) или `https://…` (`mailto:` нормализуется) | рекомендуется | communications | communications |

Без ключей: communications стартует, лог `web push disabled…`, `GET /v1/push/config` → `{ enabled: false }`.

### 2.5 Gateway / proxy (рекомендуемые)

| Переменная | Назначение | Обязательность | Где |
| --- | --- | --- | --- |
| `TRUST_PROXY_HEADERS` | `true` только если gateway за **доверенным** reverse proxy (X-Forwarded-For для rate limit) | рекомендуется за nginx/Caddy | gateway |
| `RATE_LIMIT_LOGIN_PER_MIN` и др. | переопределение лимитов | опционально | gateway |
| `INTERNAL_BIND_HOST=127.0.0.1` | не публиковать Postgres/MinIO/NATS наружу | рекомендуется | compose |

Cookie-флаги Secure/SameSite **не применяются**: auth через Bearer в `localStorage`, не cookies.

---

## 3. Авторизация и безопасность (production)

### 3.1 Модель

- Access: JWT HS256, claims `sub`, `sid`, `roles`, `exp`, `iat`, `jti`.
- Refresh: opaque ≥ 32 байт, в БД SHA-256; rotation на каждый refresh; reuse вне 20s grace → revoke family.
- Пароли: Argon2id.
- Frontend: `localStorage` + auto-refresh + multi-tab sync. Remember me нет.
- Logout: `POST /v1/auth/logout` + очистка хранилища.
- `email_verified` — мягкий статус, **не** hard-gate для login / booking / shop.
- Phone SMS verification отложено.

Подробности: [AUTH_EMAIL_AND_SESSIONS.md](./AUTH_EMAIL_AND_SESSIONS.md).

### 3.2 Endpoints (через gateway)

| Действие | Method / path |
| --- | --- |
| Login | `POST /v1/auth/login` |
| Refresh | `POST /v1/auth/refresh` |
| Logout | `POST /v1/auth/logout` |
| Password reset request/confirm | `POST /v1/auth/password-reset/request\|confirm` |
| Email verify request/confirm | `POST /v1/auth/email-verification/request` (Bearer) / `confirm` |

### 3.3 CORS и домен

1. Выставить `CORS_ORIGINS` в точный origin SPA (например `https://app.example.com`).
2. В production `CORS_ORIGINS=*` → процесс не стартует.
3. Same-origin SPA+API снижает необходимость CORS для XHR, но origin всё равно должен быть согласован с `PUBLIC_APP_URL` и ссылками в письмах.

### 3.4 HTTPS и reverse proxy

1. TLS на хосте (nginx/Caddy/балансировщик) — см. [DEPLOYMENT.md](./DEPLOYMENT.md) §9.
2. Снаружи только HTTPS; HTTP → redirect.
3. Если proxy передаёт клиентский IP: `TRUST_PROXY_HEADERS=true` **только** для доверенного proxy (иначе клиент может подделать IP в rate limit).
4. Postgres / MinIO / NATS не публиковать в интернет (`INTERNAL_BIND_HOST`).

### 3.5 Автоматически обеспечивается кодом

- Hash одноразовых токенов reset/verify; нейтральный ack на anonymous reset.
- Revoke всех сессий после успешного сброса пароля.
- Gateway rate limits на login/register/refresh/reset/verify.
- Internal routes не торчат на gateway (`/v1/internal/*` с браузера → 404).

---

## 4. Email / SMTP (REG.RU)

Полный пошаговый сценарий: [EMAIL_RUNBOOK.md](./EMAIL_RUNBOOK.md). Здесь — production checklist.

### 4.1 Ящик и SMTP

1. Создать `no-reply@salon-x.ru` (или ваш from) в панели REG.RU.
2. Прописать в production `.env` блок SMTP из §2.2, включая **`SMTP_TLS_SERVER_NAME=hosting.reg.ru`** (сертификат REG.RU на `*.hosting.reg.ru`, не на `smtp.salon-x.ru` — подтверждено адаптером mailer и runbook).
3. `PUBLIC_APP_URL=https://<публичный-origin-приложения>`.
4. Перезапуск: `docker compose up -d --force-recreate identity`.
5. Лог: `mailer ready` (host **без** пароля). Не `mailer not configured…`.

### 4.2 DNS (SPF / DKIM / DMARC)

Оператор должен настроить записи у регистратора DNS для домена отправителя по требованиям REG.RU / почтового провайдера.

**Этот репозиторий и код не подтверждают, что SPF/DKIM/DMARC уже выставлены на боевом домене.** Проверка — у оператора (`dig` / панель DNS / почтовые заголовки Authentication-Results).

### 4.3 Тесты писем

1. Залогиниться → Профиль → повторная отправка подтверждения email **или** `/forgot-password`.
2. Письмо от `EMAIL_FROM`, ссылка на `PUBLIC_APP_URL`.
3. Reset: новый пароль работает, старый нет, прежние сессии отозваны.
4. Verify: `/verify-email?token=…` → статус подтверждён; сценарии без verify по-прежнему доступны.

Опционально локальный/стендовый probe: `backend/cmd/smtprobe` (не коммитить пароль; `SMTP_TEST_TO` только в env оператора).

---

## 5. Web Push (PUSH-01)

Детали API и UX: [PUSH.md](./PUSH.md). Не переписывать реализацию.

### 5.1 VAPID

```bash
npx web-push generate-vapid-keys
```

Записать в production `.env` (не в git):

```env
VAPID_PUBLIC_KEY=<public>
VAPID_PRIVATE_KEY=<private>
VAPID_SUBJECT=no-reply@salon-x.ru
```

- Private key — только secrets store / production `.env` на сервере.
- Один key pair на все инстансы `communications`.
- Ротация ключей инвалидирует старые подписки (клиентам нужно включить push снова).

Перезапуск (нужен **rebuild** образа после фикса `normalizeVAPIDSubject`):

```bash
docker compose up -d --build --force-recreate communications
# после деплоя SPA/nginx (кэш sw-push.js):
docker compose up -d --build --force-recreate frontend
```

Ожидание в логах: `web push enabled` (не `web push disabled…`).

Если в production `.env` ещё стоит `VAPID_SUBJECT=mailto:…`, можно оставить — код снимет префикс. Предпочтительно заменить на email без `mailto:`.

### 5.2 Проверки

1. `GET /v1/push/config` (Bearer) → `{ "enabled": true, "public_key": "…" }`.
2. UI: **Настройки → Уведомления** → «Включить» (permission только по клику).
3. Подписка сохраняется (`PUT /v1/push/subscription`).
4. Событие приложения, создающее in-app notification другому пользователю → системный push.
5. Ответы push-сервиса `404`/`410` → подписка удаляется автоматически.
6. «Отключить» → только лента, без системного баннера.

Без VAPID: in-app лента/bubbles работают; device push выключен.

### 5.3 Физические устройства

Автотесты **не** заменяют проверку на железе. Оператор должен подтвердить:

| Устройство | Ожидание |
| --- | --- |
| Актуальный iPhone + установленная PWA | Web Push после Add to Home Screen (поддерживаемый iOS) |
| Samsung / Android Chrome | вкладка или PWA |
| Desktop Chrome/Edge | обычно работает |

Не объявлять «push работает везде» без этой ручной проверки.

---

## 6. Итоговый checklist оператора

| # | Действие | Как проверить | Ожидаемый результат |
| --- | --- | --- | --- |
| 1 | Домен + HTTPS на reverse proxy | Браузер `https://app…`, редирект с HTTP | Валидный сертификат, SPA открывается |
| 2 | Production secrets в `.env` (не из example) | Сверка имён с §2; секреты не в git | `JWT_SECRET`, `INTERNAL_TOKEN`, DB/MinIO заданы |
| 3 | SMTP env + ящик REG.RU | Лог identity после recreate | `mailer ready` |
| 4 | DNS SPF/DKIM/DMARC | DNS-панель / заголовки письма | Записи по требованиям провайдера (**факт подтверждает оператор**) |
| 5 | VAPID в env communications | Лог + `/v1/push/config` | `enabled: true` |
| 6 | Recreate нужных сервисов | `docker compose ps` / healthz | identity, communications, gateway, frontend healthy |
| 7 | Auth: login, refresh, logout, reset | UI + сеть | Сессия живёт; после reset все старые сессии мертвы |
| 8 | Доставка email | Inbox / spam | Письма reset/verify приходят, ссылки на `PUBLIC_APP_URL` |
| 9 | Push на iPhone и Samsung | §5.3 | Баннер + click → нужный экран |
| 10 | Логи и ошибки | `docker compose logs identity communications gateway --tail=200` | Нет panic; нет утечки паролей/VAPID private/raw tokens |

Дополнительный smoke выката: [DEPLOYMENT.md](./DEPLOYMENT.md) §12, [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md).

---

## 7. Быстрые команды (шаблон)

Подставьте свои пути/хосты. **Не** копируйте секреты в историю команд без необходимости.

```bash
# После правки .env
docker compose up -d --force-recreate identity communications gateway

# Health с хоста (если порт проброшен)
curl -fsS http://127.0.0.1:8090/healthz

# Push config (подставьте access token пользователя)
curl -fsS -H "Authorization: Bearer <access>" https://app.example.com/v1/push/config
```

Пересборка frontend после смены `VITE_API_BASE_URL` / public API origin:

```bash
docker compose build --build-arg VITE_API_BASE_URL= frontend
docker compose up -d --force-recreate frontend
```

---

## 8. Чего этот runbook намеренно не утверждает

- Что SPF/DKIM/DMARC уже настроены на боевом DNS.
- Что VAPID или SMTP-пароль уже прописаны в production.
- Что push проверен на конкретных iPhone/Samsung.
- Что production deploy/restart уже выполнен.

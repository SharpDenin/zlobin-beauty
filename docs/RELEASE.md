# Zlobin / Salon-X — release notes

Актуальная модель продукта после hardening pass. Скриншоты живого UI снимаются с запущенного стека (`docker compose up` + seed); пути экранов указаны ниже.

## Назначение

Платформа для салонов, частных мастеров, клиентов и поставщиков косметики: поиск и запись, календарь, мессенджер, портфолио, склад/заказы, база знаний.

## Роли

| Роль | Identity | Что может |
| --- | --- | --- |
| Клиент | `client` | Поиск, запись, магазин, отзывы, мессенджер, контакты |
| Мастер | `master` | Профиль, услуги, календарь, портфолио, клиенты, косметика |
| Владелец салона | `master` + membership `owner` | Салон, команда, QR-приглашения, аналитика, кресла |
| Администратор салона | `salon_admin` | Операции салона, команда, выдача заказов |
| Сотрудник / арендатор | `master` + `employee` / `renter` | Работа в чужом салоне, аренда кресла |
| Поставщик | `supplier` | Каталог, склад, KB, заказы |
| Представитель | `supplier_rep` | Полевые задачи и склад поставщика |
| Platform admin | `system_admin` | Справочники, аудит, модерация |

Публичная регистрация: только `client` / `master` / `supplier`. `salon_admin` и `supplier_rep` в production не self-assign.

## Типы мастера

Единый справочник `master_types` (профессия, не формат занятости):

колорист, парикмахер, барбер, мастер маникюра, мастер педикюра, брови и ресницы, косметолог.

Множественный выбор на регистрации и в профиле. Новые типы добавляет platform admin (`/admin/catalogs`); отключение не удаляет исторические связи.

**Формат занятости (`work_type`)** отдельно: independent / private / mobile (салон не обязателен), employee / renter / owner / chain_owner (нужен салон или приглашение).

## Capabilities

`CabinetKind` = Role + work_type. UI (`cabinet.tsx`) и backend membership/JWT проверяют одно и то же: календарь и услуги — мастерам, команда — owner/admin, склад поставщика — supplier/rep, магазин — клиенту.

## Основные сценарии

### Клиент

`/register` → `/` → `/search` → `/masters/:id` (запись, видно **кто записывается**) → `/appointments` → `/messages` → `/contacts` → `/shop` → отзыв.

### Мастер

`/register` (типы мастера) → `/master` (профиль без обязательного салона) → `/schedule` → `/calendar` → `/portfolio` → `/services` → мессенджер / контакты.

### Владелец салона

Салон → `/staff` → **Создать QR** (выбор салона, если их несколько) → мастер открывает `/invite/:token` → регистрация → membership + роль `master`.

Токен: SHA-256, TTL 72 ч, до 10 использований, revoke. Нельзя принять отозванный / просроченный / исчерпанный код.

### Поставщик

`/supplier` → `/knowledge` (поиск по названию) → заказы / склад.

## Dashboard

Режим просмотра: виджеты не двигаются. Кнопка «Редактировать» включает drag. Иерархия: профиль → действия → операции → аналитика. «Клиенты сегодня» только в аналитике. Premium — спокойный статус, не баннер.

## Календарь

`/calendar`: диапазон отображения «с/до», цвета токенов, drag/resize, swipe, long-press, persist view (`calendar.*` preferences). Установка графика: `/schedule`, не редирект с настроек профиля на сетку календаря.

## Медиа

Единый pipeline: magic-byte sniff, GIF для portfolio/message/article/service, video Range, gateway 50 MiB, понятные коды `media_*`.

## Адресная книга

`/contacts` + picker в мессенджере. API `/v1/contacts*`. Роль контакта берётся из identity, отдельной системы ролей нет.

## Навигация

Кастомные иконки. Порядок вкладок: «Ещё» → «Порядок вкладок», preference `nav.order`.

## Безопасность (кратко)

- Gateway не проксирует `/v1/internal/*`.
- Lookup email только для professional roles.
- Upload: sniff MIME, size, purpose, auth.
- CORS + security headers на gateway; SPA nginx: nosniff, DENY frame, Referrer-Policy, CSP.
- `ALLOW_DEV_BILLING` запрещён в production config.
- Invite tokens не хранятся plaintext.
- Production errors без stack/SQL.

Ограничения, которые осталось проверить на живом стенде: e2e Playwright против полного compose, CSP vs внешний QR-рендер (`api.qrserver.com`), Argon2 параметры.

## Запуск

См. корневой `README.md`. Gateway `:8090`. Demo: `Password123!`.

Ключевые env: `JWT_SECRET`, `INTERNAL_TOKEN`, `CORS_ORIGINS`, `PUBLIC_APP_URL` (ссылки QR), `ALLOW_DEV_BILLING=false` в production, `MEDIA_URL` у marketplace.

## Экраны для скриншотов (после `compose up`)

1. Регистрация мастера с типами — `/register`
2. Профиль мастера без салона — `/master`
3. Dashboard view/edit — `/`
4. Портфолио сетка — `/portfolio`
5. Календарь mobile day — `/calendar`
6. QR на `/staff`
7. Приглашение — `/invite/:token`
8. Контакты — `/contacts`
9. Карточка мастера / услуга edge-to-edge — `/masters/:id`

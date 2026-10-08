# Release report

Дата фиксации: 3 октября 2026. Iteration: final hardening 4 + пакет документации.

## Release status

**READY FOR RELEASE** при выполнении production requirements из [SECURITY.md](SECURITY.md) и [DEPLOYMENT.md](DEPLOYMENT.md).

Блокеров в приложении на момент отчёта: **0**.

## Tests

| Проверка | Результат |
| --- | --- |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm audit` | 2 moderate, только `@vitest/mocker` / Vitest 3; фикс = Vitest 5 (breaking, не делали) |
| `govulncheck ./...` | 6 находок stdlib **Go 1.26.5**, исправлены в **1.26.6** |
| `npx tsc -b` | pass |
| `npx vitest run` | 270 / 270 |
| `npx vite build` | pass при пустом `VITE_API_BASE_URL`; в бандле нет `localhost:8090`. Сборка с loopback API падает (guard) |
| Go tests (config, moderation, booking, media domain, seed, gateway, orgs, marketplace, commerce, …) | pass |
| Playwright security / hardening / pwa / visit-plan / demo-mvp booking | pass после правок селекторов записи |

Полный старый `salon-x.spec` suite не является критерием этого релиза.

## Security

- JWT / logout / one-shot session notice — e2e
- IDOR: календарь, записи, портфолио, planner, контакты, media DELETE, invites, knowledge write, orders, internal 404
- CORS `*` в production запрещён кодом
- Upload: magic-byte, лимиты, owner-only delete
- Модерация на сервере
- Нет секретов и dev-API в production SPA (чистая сборка без `VITE_API_BASE_URL`; Vite блокирует bake-in `localhost`)

## Browser QA

Выполнено в Cursor-браузере на `127.0.0.1:5173` (мышь, не палец):

- старт владельца с KPI и записями 3 октября 2026
- календарь (список + настройки, русские цвета)
- карточка записи
- контакты и сообщения
- QR-приглашение
- клиент: поиск → Стрижка → слот → успех
- поставщик: знания и каталог
- logout без scare

Playwright: phone-360/390 календарь и основные сценарии; desktop-1920 owner/календарь/поставщик.

Пакет снимков для документации (`docs/screenshots/`, 3 октября 2026): Playwright Chromium, тёмная тема, 1440 и 390. Это не проверка физического устройства.

## Not verified

- физический touch: drag / swipe / long-press
- физическая камера для QR
- системный выбор файла / камера телефона
- production Docker + TLS на домене заказчика
- полный исторический e2e suite
- отдельные проходы 430, 768, 834, 1440
- установка PWA на iOS/Android

## Residual risks

- Обновить toolchain до **Go 1.26.6+**
- Vitest 3 moderate, только dev
- Исторические demo-имена в длинном архиве записей (`P6 Blacklist`, Phase9-товары)
- Публичное чтение витринных медиа — намеренно
- Seed мастер-класса: нужен будущий сеанс (логика seed это учитывает; на уже залитой базе сеанс 12 октября 2026 создан вручную в hardening)

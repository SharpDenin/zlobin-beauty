# PWA

Плагин `vite-plugin-pwa` в `frontend/vite.config.ts`. В production-сборке: `dist/manifest.webmanifest`, `dist/sw.js`.

## Manifest

- Имя: Salon-X
- `display: standalone`, `start_url: /`, `theme_color` / `background_color`: `#0B0D12`
- Иконки: 192, 512, maskable 512
- Статический файл также лежит в `frontend/public/manifest.webmanifest`

## Service worker

- Режим `generateSW`, `registerType: 'prompt'`
- Регистрация в приложении (`PwaProvider`), не автоинжект
- `cleanupOutdatedCaches: true`
- HTML в precache workbox **не** кладётся пачкой ассетов; навигация — runtime NetworkFirst
- `navigateFallbackDenylist`: `/v1/`, `/api/`

## Кэш

| Запрос | Стратегия |
| --- | --- |
| `/v1/*`, `/api/*` | **NetworkOnly** — живые данные, без кэша API |
| Документ (navigate) | **NetworkFirst**, кэш `pages`, таймаут 3 с |
| Google Fonts | CacheFirst, длинный TTL |

Максимум файла в precache: 5 МиБ.

## Dev

`devOptions.enabled` только если `VITE_PWA_DEV=true`. Обычный `npm run dev` **без** service worker. Иначе старый SW с другого origin легко перехватывает `/login`.

## Production

Nginx: `index.html` и `sw.js` с `Cache-Control: no-cache`. Оболочка обновляется, API не обслуживается из кэша.

Пользователю при новой версии показывается предложение обновить (prompt).

## Старый service worker

Если после смены порта/хоста (например, когда-то открывали `localhost` и `127.0.0.1`) страница ведёт себя «как старая»:

1. DevTools → Application → Service Workers → Unregister
2. Clear site data для этого origin
3. Жёсткое обновление

Не оставлять включённый dev SW на машине разработчика. Не обещать, что старый кэш «сам всегда безопасен» без `cleanupOutdatedCaches` — очистка как раз включена в текущей сборке.

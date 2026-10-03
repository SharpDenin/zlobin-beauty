# Salon-X Design System — MIDNIGHT / SIGNAL

This is the visual source of truth for Salon-X. Dark MIDNIGHT / SIGNAL is the default. A light theme uses the same components and tokens, with the values in `html[data-theme="light"]`.

Use this document, plus CSS/JS tokens, for every UI change: new screens, new components, bugfixes, dashboards, tables, forms, and role-specific surfaces.

**Do not invent a second visual language.** If a new entity appears (product, service, master, supplier, order, appointment, client), express it with the card, overlay, image, motion, and form patterns defined here.

Exact HEX values in this file take priority over any moodboard screenshot.

## Character

Salon-X is a modern technical professional platform inside a premium beauty ecosystem.

It should feel: **premium, atmospheric, polished, modern, controlled, production-ready**.

It must not feel like: a generic CRM, a cheap UI-kit template, typical purple SaaS, neon cyberpunk, a game UI, glassmorphism everywhere, or a flat unfilled MVP.

**MIDNIGHT / SIGNAL** is a dark-first interface with one expressive violet accent, now with **visual depth**: layered canvas light, reserved gradients, imagery, and meaningful motion. The light theme keeps that accent and the same spacing, type, and components on a cool paper canvas (`#F3F5FA` / `#FFFFFF`) with deeper ink (`#1C2130`) and a slightly deeper violet (`#545BE0`) so text and buttons stay readable. User choice is stored in `localStorage` (`zb.theme`) and wins over `prefers-color-scheme`.

The product should communicate with **images, hierarchy, and space** first. Long instructional paragraphs are a last resort.

Do not say «Кабинет» in the UI. Role labels come from `cabinetLabel` (владелец салона, частный мастер, поставщик, …).

## Owner start

Только домашняя страница владельца салона (`OwnerStartPage`, `owner-home.css`):

- Фон — **атмосферное лесное фото** (`/owner-atmosphere*.jpg`) + затемнение; поверх — glass panel (translucent + blur). Не общий `--gradient-canvas`.
- Композиция как у референса B: левый strip фона, справа glass UI; крупный hero, KPI в одну полосу, день салона, appointment cards, mint CTA, management tiles 2×2.
- Не переносить photo/glass атмосферу на остальные экраны. Остальной продукт — MIDNIGHT / SIGNAL.

## Product UX (обязательные правила)

- Один очевидный primary action на вид.
- Сложную сущность не вываливать целиком: карточка → деталь / drawer / modal.
- Обязательные поля помечать `*`.
- Тексты по-русски, без UUID, без внутренних кодов, без «undefined».
- Mobile-first: 44px зоны нажатия, не сужать десктоп в столбик.
- Меньше кликов: если шаг можно убрать без потери ясности — убрать.

## Tokens

Canonical CSS lives in `frontend/src/shared/ui/styles.css` (`:root`).
JS/chart helpers live in `frontend/src/shared/ui/tokens.ts` and `frontend/src/shared/ui/chart-theme.ts`.

Prefer `var(--token)` / imported JS tokens. Do not scatter hex across pages.

### Color

| Token | Hex | Role |
| --- | --- | --- |
| `--color-background` | `#0B0D12` | App canvas. Never `#000000`. |
| `--color-background-elevated` | `#10131A` | Slightly lifted canvas (rare nested shells) |
| `--color-surface` | `#141821` | Cards, panels, sidebar, modal sheets |
| `--color-surface-2` | `#1D2230` | Nested surfaces, hover, default border |
| `--color-surface-3` | `#252B3B` | Elevated hover / skeleton highlight |
| `--color-text-primary` | `#F5F7FA` | Main text. Never pure `#FFFFFF` for all copy. |
| `--color-text-secondary` | `#9EA6B5` | Meta, placeholders, inactive nav |
| `--color-primary` | `#7C82FF` | Main action / selected / focus |
| `--color-primary-soft` | `#A8ACFF` | Secondary accent text, icon, button highlight |
| `--color-success` | `#5DC08B` | Success only |
| `--color-warning` | `#FFB020` | Warning / waiting only |
| `--color-danger` | `#EF7777` | Error / destructive only |
| `--color-info` | `#8B9BC7` | Informational only (not a second brand) |

Soft fills (`--color-*-muted` / `-soft`) are translucent versions of those colors. They are not extra brand hues.

Screen recipe, in order:

`#0B0D12` → atmospheric canvas light → `#141821` → `#1D2230` → `#F5F7FA` → `#9EA6B5` → `#7C82FF`

Violet is an accent, not a surface. Do not turn the whole UI purple. Do not mix many bright accents on one screen. Semantic colors appear only when the data meaning requires them.

### Gradients (allowed, prescribed)

Gradients are **system presets**, not decoration on every card.

| Token | Where |
| --- | --- |
| `--gradient-canvas` | `body` / app canvas only |
| `--gradient-hero` | Hero, empty states, rare section intros |
| `--gradient-primary-button` | Primary button fill only |
| `--gradient-image-fallback` | Image placeholders / failed media |
| Owner start atmosphere | Salon-owner home only: deep teal/forest gradient (no photo). Page-scoped in `owner-home.css`. |

Rules:

- One atmospheric treatment per screen (canvas + optional hero). Do not stack extra page-level gradients.
- Cards stay solid `--color-surface`. Do not paint every card with a gradient.
- Accent glow (`--shadow-glow`) is for **selected / focused / primary CTA**, not for idle cards.
- No neon edges, no rainbow, no full-screen blur.

### Overlay

| Token | Role |
| --- | --- |
| `--overlay-scrim` | `rgba(11, 13, 18, 0.72)` — modal / drawer / more-menu |

### Typography

Font: **Inter** only (400 / 500 / 600 / 700). No second display font. `--font-display` is Inter with tighter tracking on large titles.

| Style | Token / class | Size | Weight |
| --- | --- | --- | --- |
| Display | `.display` / `--text-display` | 40px (clamped) | 700 |
| H1 | `h1` | 32px | 700 |
| H2 | `h2` | 24px | 600 |
| H3 | `h3` | 20px | 600 |
| H4 | `h4` | 16px | 600 |
| Body large | `--text-lg` | 16px | 400 |
| Body | default | 14px | 400 |
| Body small | `--text-sm` / `.meta` | 13px | 400–500 |
| Caption | `--text-xs` / `.caption` | 12px | 400–500 |
| Label | `.field label` / `.label-text` | 13px | 600 |
| Button | `.btn` | 14px | 700 |
| Error | `.field .error` | 13px | 400, `--color-danger` |
| Empty title | `.empty-state h2` | 16px | 600 |

Prefer a short title + visual (image, status badge, metric) over a paragraph. Empty-state copy stays under ~2 lines.

### Spacing

8px grid. Allowed: 4, 8, 12, 16, 24, 32, 40, 48, 64. Prefer 8 / 16 / 24 / 32 / 48.

### Radius

| Use | Value |
| --- | --- |
| Default | 14px (`--radius-md`) |
| Large cards / modals | 16–20px (`--radius-lg`) |
| Small controls | 8–12px (`--radius-sm`) |
| Badges / pills / avatars | 9999px (`--radius-pill`) |

Do not use fully round containers for ordinary blocks. Primary buttons are **not** pills.

### Shadows and glow

| Token | Use |
| --- | --- |
| `--shadow-sm` | Resting cards |
| `--shadow-md` | Hover, hero, toast |
| `--shadow-lg` | Modal / drawer sheets |
| `--shadow-glow` | Selected card, focused primary surface |

Glow is a **soft violet wash**, not a neon halo around every control. Idle chrome stays quiet.

### Motion

| Token | Value | Use |
| --- | --- | --- |
| `--motion-fast` | 120ms | Hover, button press |
| `--motion-normal` | 200ms | Overlay fade, border |
| `--motion-emphasized` | 280ms | Modal, drawer, toast |
| `--ease-standard` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Interactive |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Enter |

Prescribed animations:

- Overlay: fade (`overlay-in`)
- Modal sheet: fade + slight scale/translate (`modal-in`)
- Drawer / more-panel: slide + fade (`drawer-in`)
- Dropdown / hint: fade + small translate (`dropdown-in`)
- Toast: fade + translate (`toast-in`)
- Skeleton: shine only while loading

No looping decorative motion. Always respect `prefers-reduced-motion`.

### Z-index

| Layer | Token | Value |
| --- | --- | --- |
| Sticky nav / topbar | `--z-sticky` | 20 |
| Dropdown / hint | `--z-dropdown` | 30 |
| Drawer / more menu | `--z-drawer` | 40 |
| Modal | `--z-modal` | 50 |
| Toast | `--z-toast` | 80 |

Do not invent `z-index: 9999`. Shared `Modal` / `Drawer` / `Overlay` use this scale. Nested overlays increment from `--z-modal` (50, 51, …) so the top layer stays above the one beneath. `--z-toast` (80) remains above overlays.

### Breakpoints

`--bp-phone` 390 · `--bp-tablet` 768 · `--bp-laptop` 1024 · `--bp-desktop` 1440.

## Surfaces and backgrounds

| Layer | Treatment |
| --- | --- |
| App canvas | `--gradient-canvas` on `body` |
| Page | Transparent over canvas; content in `.page` |
| Hero / intro | `--gradient-hero` |
| Section | No extra fill unless a card/grid |
| Card | Solid `--color-surface` |
| Modal overlay | `--overlay-scrim` |
| Modal sheet | Solid surface + `--shadow-lg` |

Readability wins. If a gradient sits under text, keep contrast: primary text on dark, never thin grey on violet wash.

## Components

### Buttons

- **Primary:** `--gradient-primary-button`, text `#0B0D12`, quiet glow. One main action per view.
- **Secondary:** surface + border. Hover lifts border to `--color-border-strong`.
- **Ghost:** lowest emphasis.
- **Danger:** soft danger fill. Only irreversible actions.
- **Icon:** `.btn-icon`, 44×44 tap target.
- **Loading:** `.btn-loading` — disable pointer, keep layout.
- Press scale is `--motion-fast`. Disabled: opacity 0.6, no glow.

### Inputs

Default: background `#0B0D12`, border `#1D2230`, text `#F5F7FA`, placeholder `#9EA6B5`.
Focus: border `#7C82FF` + `--color-focus-ring`.
Error: `#EF7777`.
Checkbox / radio: `accent-color` primary, 18px.
Switch: existing `.switch` track, primary when on.
Always use a visible label. Placeholder is not a label.

### Cards

All cards: radius 14px, 1px `--color-border`, `--shadow-sm`, padding 16px, solid surface.

| Kind | Extra |
| --- | --- |
| Standard | `.card` |
| Interactive | `.card-interactive` or existing `button.service-card` — hover lift 1px + `--shadow-md` |
| Image | Media on top (`.media-frame`), then title + meta. Image is the primary signal |
| Profile | Portrait / avatar + name; bio is optional and short |
| Service | Landscape or 4:3 media; duration/price as meta, not a paragraph |
| Product | 4:5 media; brand as caption; price as strong |
| Appointment | Status badge + time; client/service names, not essays |
| Knowledge | Cover 16:9 or 2:1 (`.kb-cover`); title over image hierarchy |
| Dashboard | `.dashboard-tile` — metric first, label second |

Selected: `--shadow-glow` + primary border. Disabled: opacity 0.55.

Do not put a unique gradient on each card type.

### Images

Imagery is part of the system. Use `MediaImage` + `.media-frame*`.

| Context | Frame | Fit |
| --- | --- | --- |
| Master profile | `.media-frame--portrait` or `.media-frame--avatar` | `cover` |
| Service | `.media-frame--landscape` or square in grids | `cover` |
| Product | `.media-frame--product` | `cover` |
| Article | `.media-frame--cover` / `.kb-cover` | `cover` |
| Salon | `.media-frame--landscape` | `cover` |
| Thumb | `.media-frame--thumb` | `cover` |

Loading: `.media-skeleton`. Missing/error: `.media-fallback` (initials or em dash), **never** a 1×1 transparent PNG as content. Seed and production media must be real photographs.

### Overlays

Use shared primitives — do not add a new `.modal-backdrop` tree on a page:

- `Modal` — centered / mobile bottom sheet (`frontend/src/shared/ui/Modal.tsx`)
- `Drawer` — more-menu and side/bottom sheets (`frontend/src/shared/ui/Drawer.tsx`)
- `Overlay` — portal + a11y shell for custom layers (lightbox)
- `acquireOverlayLock` / `useOverlayLock` — nested-safe body scroll lock

Behavior:

- Scrim: `--overlay-scrim`, fade in (`overlay-in`)
- Desktop modal: centered sheet, `modal-in`
- Mobile modal: full-width bottom sheet below `--bp-phone` (480px)
- Drawer: bottom sheet, `drawer-in`
- Scroll lock: reference-counted. `document.body` is `position: fixed` with `top: -scrollY` while any overlay is open; scroll position is restored on the final close. Overlay content marked `[data-overlay-scroll]` may scroll; the page behind must not.
- Escape closes only the top overlay. `closeOnEscape={false}` opts out.
- Reduced motion: existing global `prefers-reduced-motion` rule keeps enter/exit effectively instant.

### Navigation

Desktop: left sidebar `#141821` + workspace canvas. Active: primary muted fill. Inactive: secondary text.

Mobile: bottom navigation + more-drawer. **Not** a squeezed desktop layout. Prefer vertical stacks, image cards, sticky primary actions, 44px controls.

Logo: `frontend/public/logo.png` via `BrandLogo`. Never recolor, stretch, distort, or add effects.

### Dashboard and charts

Data first. Chart primary: `#7C82FF`. Secondary: `#A8ACFF`, `#9EA6B5`, `#6B7385`. Info series may use `--color-info`. No rainbow charts.

### Icons

One outline set, one optical weight. Do not mix emoji and extra icon kits without need.

### States

| State | Pattern |
| --- | --- |
| Loading | `.skeleton` / `.media-skeleton` on the real layout |
| Empty | `.empty-state` on `--gradient-hero`, short title + one action |
| Error | `.state-box.error` |
| Forbidden | `.state-box.forbidden` |
| Success | `.state-box.success` or toast |
| Not found | `.empty-state` |

These are product UI, not debug dumps.

## Responsive principles

**Desktop (≥768):** multi-column, sidenav, tables, dashboards, side-by-side messenger later.

**Tablet:** compress gaps, keep grid, collapse secondary columns.

**Mobile:** vertical layout. Cards over tables. Full-screen editors instead of tiny centered modals. Bottom nav. Touch targets ≥44px. Calendar, messenger, shop, knowledge, services, and dashboard **must not** be a narrowed desktop page — later phases implement alternate layouts using this rule.

## Forbidden

- Neon / cyberpunk glow on large regions
- Glassmorphism as the default surface (no blur-on-everything)
- Rainbow cards, acid extra hues, extra brand violets
- `#000000` canvas, `#FFFFFF` as all body text
- Looping decorative animation
- Transparent 1×1 PNG as a photograph
- A different component style per page
- Gradients on every card
- Emoji instead of icons
- Inventing a second palette or component kit

## Allowed (this is the change from the earlier MVP spec)

- Prescribed canvas / hero / button / fallback **gradients**
- Soft accent **glow** on selected + primary CTA
- Atmospheric layered **backgrounds**
- Image-first cards and covers
- Enter/exit **motion** for overlay, drawer, toast, dropdown
- Slightly stronger elevation shadows

## How to extend

1. Open this file.
2. Add the token in `styles.css` `:root` and `tokens.ts` together.
3. Reuse card / media-frame / overlay / motion patterns.
4. Do not restyle a single page with one-off hex.

Implementation entry points:

- Tokens: `frontend/src/shared/ui/styles.css`, `frontend/src/shared/ui/tokens.ts`
- Logo: `frontend/src/shared/ui/BrandLogo.tsx`
- Media: `frontend/src/shared/ui/MediaImage.tsx`
- Charts: `frontend/src/shared/ui/chart-theme.ts`
- Shell: `frontend/src/app/layout.tsx`

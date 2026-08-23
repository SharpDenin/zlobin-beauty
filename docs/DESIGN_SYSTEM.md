# Salon-X Design System — MIDNIGHT / SIGNAL

This is the visual source of truth for Salon-X. It is not a theme toggle and not a one-off restyle.

Use this document, plus CSS/JS tokens, for every UI change: new screens, new components, bugfixes, dashboards, tables, forms, and role-specific cabinets.

**Do not invent a new visual language.** If a new entity appears (product, service, master, supplier, order, appointment, client), express it with existing cards, badges, type, buttons, inputs, tables, modals, and navigation.

Exact HEX values in this file take priority over any moodboard screenshot.

## Character

Salon-X is a modern technical professional platform inside a premium beauty ecosystem.

It should feel: technical, modern, premium, controlled, professional, clean, dense without chaos.

It must not feel like: a generic CRM, a cheap UI-kit template, typical purple SaaS, neon cyberpunk, a game UI, heavy glassmorphism, or a pure-black screen with decorative glow.

MIDNIGHT / SIGNAL is a restrained dark-first interface with **one** expressive violet accent.

## Tokens

Canonical CSS lives in `frontend/src/shared/ui/styles.css` (`:root`).
JS/chart helpers live in `frontend/src/shared/ui/tokens.ts` and `frontend/src/shared/ui/chart-theme.ts`.

Prefer `var(--token)` / imported JS tokens. Do not scatter hex across pages.

### Color

| Token | Hex | Role |
| --- | --- | --- |
| `--color-background` | `#0B0D12` | App canvas. Never `#000000`. |
| `--color-surface` | `#141821` | Cards, panels, sidebar, modals |
| `--color-surface-2` | `#1D2230` | Nested surfaces, hover/active, borders |
| `--color-text-primary` | `#F5F7FA` | Main text. Never pure `#FFFFFF` for all copy. |
| `--color-text-secondary` | `#9EA6B5` | Descriptions, meta, placeholders, inactive nav |
| `--color-primary` | `#7C82FF` | Main action / selected / focus |
| `--color-primary-soft` | `#A8ACFF` | Secondary accent text/icons only |
| `--color-success` | `#5DC08B` | Success only |
| `--color-warning` | `#FFB020` | Warning / waiting only |
| `--color-danger` | `#EF7777` | Error / destructive only |

Soft fills for badges and selected states are translucent versions of those colors (`--color-*-muted`). They are not extra brand hues.

Screen recipe, in order:

`#0B0D12` → `#141821` → `#1D2230` → `#F5F7FA` → `#9EA6B5` → `#7C82FF`

Violet is an accent, not a surface. Do not turn the whole UI purple. Do not mix many bright accents on one screen. Semantic colors appear only when the data meaning requires them.

### Typography

Font: **Inter** only (400 / 500 / 600 / 700). No second display font.

| Style | Size | Weight |
| --- | --- | --- |
| H1 | 32px | 700 |
| H2 | 24px | 600 |
| H3 | 20px | 600 |
| H4 | 16px | 600 |
| Body large | 16px | 400 |
| Body | 14px | 400 |
| Body small | 13px | 400 |
| Caption | 12px | 400 |

Not every screen needs every size. Keep hierarchy. Labels/nav use Medium (500).

### Spacing

8px grid. Allowed: 4, 8, 12, 16, 24, 32, 40, 48, 64. Prefer 8 / 16 / 24 / 32 / 48. Do not invent 13 / 19 / 27 / 37 without a hard reason.

### Radius

| Use | Value |
| --- | --- |
| Default | 14px (`--radius-md`) |
| Large cards / modals | 16–20px (`--radius-lg`) |
| Small controls | 8–12px (`--radius-sm`) |
| Badges / pills | 9999px (`--radius-pill`) |

Do not use fully round containers for ordinary blocks. Primary buttons are **not** pills.

### Borders and shadows

Border: `#1D2230` or `--color-border`. Quiet. Do not outline every region. No bright white borders.

Shadows: small, low-opacity, no glow. No neon halo around primary controls. A faint violet focus ring is allowed only on the focused control.

## Components

### Buttons

- **Primary:** background `#7C82FF`, text `#0B0D12`. One main action: Create, Save, Book, Buy, Confirm, Publish.
- **Secondary:** surface + border. Must not compete with primary.
- **Ghost:** lowest emphasis, secondary actions only.
- **Danger:** only irreversible / delete actions.

### Inputs

Default: background `#0B0D12`, border `#1D2230`, text `#F5F7FA`, placeholder `#9EA6B5`.
Focus: border/accent `#7C82FF`.
Error: `#EF7777`.
Always use a visible label. Placeholder is not a label.

### Cards

Background `#141821`, border `#1D2230`, radius 14–18px, clear title, hierarchy, metadata, action if needed, enough padding. Information over decoration.

### Badges

Pill + **text**. Color alone is not a status.

Examples: New → primary, Active → success, Waiting → warning, Error → danger.

### Tables

Dense and readable. Header = secondary text. Values = primary text. Status = semantic badge. Row hover = `#1D2230`. Do not paint whole rows in bright colors.

### Modals

Surface `#141821`, border `#1D2230`, radius 16–20px. Structure: title, description, content, actions. Primary action on the right. Danger must be obvious. Modal is a layer, not a black overlay of the same tone as the page.

### Navigation

Desktop: left sidebar `#141821` + workspace `#0B0D12`.
Active item: `#7C82FF`. Inactive: `#9EA6B5`.
Only the active item gets a strong accent. Do not color every nav row.

Mobile: same system via bottom navigation + drawer. Not a separate mobile design.

Logo: top-left of sidebar (desktop), compact in the header (mobile), larger on auth. Use `frontend/public/logo.png`. Do not recolor, stretch, distort, or add effects. Keep clear space around it.

### Dashboard and charts

Data first, decoration second. Metrics, cards, charts, tables, activity, status — only when they mean something.

Chart primary series: `#7C82FF`. Secondary series: muted (`#A8ACFF`, `#9EA6B5`, `#6B7385`). Success / warning / danger only when the series is semantic. No rainbow charts.

### Icons

One outline set, one optical weight. Do not mix outline, filled, 3D, emoji, and extra libraries without need.

### States

Loading, empty, and error use the same surfaces and type. Empty states are quiet cards, not illustrated posters.

## Forbidden without explicit approval

Gradients, glassmorphism, heavy blur, neon glow, huge decorative illustrations, acid colors, random extra violets, `#000000` as canvas, `#FFFFFF` as all body text, rainbow cards, heavy shadows, overly round blocks, emoji instead of icons, a different component style per page.

## How to extend

1. Open this file.
2. Use existing tokens and components.
3. Keep spacing and type.
4. If a new pattern is truly required, add it here and to tokens first.

Implementation entry points:

- Tokens: `frontend/src/shared/ui/styles.css`, `frontend/src/shared/ui/tokens.ts`
- Logo: `frontend/src/shared/ui/BrandLogo.tsx`
- Charts: `frontend/src/shared/ui/chart-theme.ts`
- Shell: `frontend/src/app/layout.tsx`

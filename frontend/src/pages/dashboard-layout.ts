import type { Layout, LayoutItem, ResponsiveLayouts } from 'react-grid-layout'

export type WidgetId =
  | 'alerts'
  | 'calendar'
  | 'today'
  | 'upcoming'
  | 'pending'
  | 'messages'
  | 'tasks'
  | 'orders'
  | 'deliveries'
  | 'analytics'

export type Breakpoint = 'lg' | 'md' | 'sm' | 'xs'
export type WidgetPosition = Pick<LayoutItem, 'x' | 'y' | 'w' | 'h'>
export type WidgetLayout = {
  id: WidgetId
  enabled: boolean
  positions: Partial<Record<Breakpoint, WidgetPosition>>
}
export type SizePreset = 'compact' | 'wide' | 'large'

export type WidgetDefinition = {
  id: WidgetId
  title: string
  defaultPosition: WidgetPosition
  minW: number
  minH: number
}

/**
 * react-grid-layout picks the widest breakpoint whose value is *strictly* below the container width
 * (so exactly 1200px is still `md`). `breakpointForWidth` mirrors that; a unit test compares it with
 * RGL's own `getBreakpointFromWidth`.
 */
export const DASHBOARD_BREAKPOINTS: Record<Breakpoint, number> = { lg: 1200, md: 768, sm: 480, xs: 0 }
export const DASHBOARD_COLS: Record<Breakpoint, number> = { lg: 12, md: 8, sm: 4, xs: 1 }
export const DASHBOARD_MARGIN = { lg: [18, 18], md: [14, 14], sm: [12, 12], xs: [10, 10] } as const

const BREAKPOINT_ORDER: Breakpoint[] = ['lg', 'md', 'sm', 'xs']

export function breakpointForWidth(width: number): Breakpoint {
  if (width > DASHBOARD_BREAKPOINTS.lg) return 'lg'
  if (width > DASHBOARD_BREAKPOINTS.md) return 'md'
  if (width > DASHBOARD_BREAKPOINTS.sm) return 'sm'
  return 'xs'
}

/** Phone-like widths: one column, no free-form 2D placement. */
export function isCompactBreakpoint(bp: Breakpoint): boolean {
  return bp === 'sm' || bp === 'xs'
}

/** Widget ids that used to exist (or were never valid) and must never survive a load/save round-trip. */
export const REMOVED_WIDGET_IDS = new Set(['clients_today', 'kpi-today-clients', 'kpi_today_clients'])

/** Legacy ids from older payloads that map onto a current widget. */
const LEGACY_ID: Record<string, string> = { important_messages: 'alerts' }

/**
 * Reading order for phones and for anything the user has not arranged themselves:
 * urgent → today's numbers → upcoming / calendar → tasks / orders → analytics (always last).
 */
export const VIEW_ORDER: WidgetId[] = [
  'alerts',
  'today',
  'pending',
  'messages',
  'upcoming',
  'calendar',
  'tasks',
  'orders',
  'deliveries',
  'analytics',
]

/** Small numeric tiles; on phones consecutive tiles are shown as one compact row. */
const TILE_IDS = new Set<WidgetId>(['today', 'pending', 'messages', 'orders', 'deliveries'])

export const LIBRARY: WidgetDefinition[] = [
  { id: 'alerts', title: 'Важное', defaultPosition: { x: 0, y: 0, w: 12, h: 5 }, minW: 6, minH: 3 },
  { id: 'calendar', title: 'Календарь', defaultPosition: { x: 0, y: 5, w: 12, h: 18 }, minW: 8, minH: 10 },
  { id: 'today', title: 'Сегодня', defaultPosition: { x: 0, y: 23, w: 3, h: 4 }, minW: 2, minH: 3 },
  { id: 'pending', title: 'Ожидают подтверждения', defaultPosition: { x: 3, y: 23, w: 3, h: 4 }, minW: 2, minH: 3 },
  { id: 'messages', title: 'Сообщения', defaultPosition: { x: 6, y: 23, w: 3, h: 4 }, minW: 2, minH: 3 },
  { id: 'upcoming', title: 'Ближайшие записи', defaultPosition: { x: 0, y: 27, w: 6, h: 8 }, minW: 4, minH: 5 },
  { id: 'analytics', title: 'Моя статистика', defaultPosition: { x: 6, y: 27, w: 6, h: 8 }, minW: 4, minH: 5 },
  { id: 'tasks', title: 'Задачи', defaultPosition: { x: 0, y: 35, w: 4, h: 5 }, minW: 3, minH: 4 },
  { id: 'orders', title: 'Заказы', defaultPosition: { x: 4, y: 35, w: 4, h: 5 }, minW: 3, minH: 4 },
  { id: 'deliveries', title: 'Доставки', defaultPosition: { x: 8, y: 35, w: 4, h: 5 }, minW: 3, minH: 4 },
]

export const DEFAULT_IDS: WidgetId[] = ['alerts', 'calendar', 'today', 'pending', 'upcoming', 'analytics']

function defOf(id: WidgetId): WidgetDefinition {
  return LIBRARY.find((w) => w.id === id)!
}

function isPosition(value: unknown): value is WidgetPosition {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return [p.x, p.y, p.w, p.h].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    (p.x as number) >= 0 && (p.y as number) >= 0 && (p.w as number) >= 1 && (p.h as number) >= 1
}

/** Keeps only well-formed per-breakpoint positions (finite numbers, w/h >= 1); returns null when `raw` is not an object. */
function cleanPositions(raw: unknown): Partial<Record<Breakpoint, WidgetPosition>> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const src = raw as Record<string, unknown>
  const out: Partial<Record<Breakpoint, WidgetPosition>> = {}
  for (const bp of BREAKPOINT_ORDER) {
    const p = src[bp]
    if (isPosition(p)) out[bp] = { x: p.x, y: p.y, w: p.w, h: p.h }
  }
  return out
}

function canonicalId(rec: Record<string, unknown>): string {
  const raw = typeof rec.id === 'string' && rec.id ? rec.id : typeof rec.type === 'string' ? rec.type : ''
  return LEGACY_ID[raw] ?? raw
}

/**
 * Pure server-payload migration: drops non-objects, removed ids (`clients_today`, `kpi-today-clients`, …)
 * and unknown ids, resolves legacy `important_messages` / type-only items to a canonical `id`.
 * `calendar_colors` preferences pass through untouched.
 */
export function migrateWidgets(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return []
  const out: Array<Record<string, unknown>> = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const rec = item as Record<string, unknown>
    const id = canonicalId(rec)
    if (!id) continue
    if (id === 'calendar_colors') {
      out.push(rec)
      continue
    }
    if (REMOVED_WIDGET_IDS.has(id)) continue
    if (!LIBRARY.some((w) => w.id === id)) continue
    out.push({ ...rec, id })
  }
  return out
}

export function defaultLayout(): WidgetLayout[] {
  return DEFAULT_IDS.map((id) => ({ id, enabled: true, positions: { lg: { ...defOf(id).defaultPosition } } }))
}

export function normalizeLayout(raw: unknown): WidgetLayout[] {
  const parsed: WidgetLayout[] = []
  const seen = new Set<WidgetId>()
  for (const rec of migrateWidgets(raw)) {
    if (rec.id === 'calendar_colors') continue
    const id = rec.id as WidgetId
    if (seen.has(id)) continue
    seen.add(id)
    const positions = cleanPositions(rec.positions) ?? { lg: legacyPosition(rec, defOf(id)) }
    parsed.push({ id, enabled: rec.enabled !== false, positions })
  }
  for (const id of DEFAULT_IDS) {
    if (!seen.has(id)) parsed.push({ id, enabled: true, positions: { lg: { ...defOf(id).defaultPosition } } })
  }
  return parsed
}

function legacyPosition(rec: Record<string, unknown>, def: WidgetDefinition): WidgetPosition {
  const sizes: Record<string, Pick<WidgetPosition, 'w' | 'h'>> = {
    small: { w: 3, h: 4 },
    medium: { w: 6, h: 6 },
    large: { w: 8, h: 9 },
    full: { w: 12, h: def.id === 'calendar' ? 18 : 6 },
    '2x2': { w: 3, h: 4 },
    '4x2': { w: 4, h: 4 },
    '4x3': { w: 4, h: 6 },
    '8x3': { w: 8, h: 6 },
    '8x6': { w: 8, h: 12 },
    '12x2': { w: 12, h: 4 },
    '12x4': { w: 12, h: 8 },
  }
  return {
    ...def.defaultPosition,
    ...(sizes[String(rec.size)] ?? {}),
    ...(Number.isFinite(rec.x) ? { x: Number(rec.x) } : {}),
    ...(Number.isFinite(rec.y) ? { y: Number(rec.y) } : {}),
    ...(Number.isFinite(rec.w) ? { w: Number(rec.w) } : {}),
    ...(Number.isFinite(rec.h) ? { h: Number(rec.h) } : {}),
  }
}

function viewRank(id: WidgetId): number {
  const idx = VIEW_ORDER.indexOf(id)
  return idx === -1 ? VIEW_ORDER.length : idx
}

/** Stable sort into the reading hierarchy (analytics last). */
export function sortForView(widgets: WidgetLayout[]): WidgetLayout[] {
  return [...widgets].sort((a, b) => viewRank(a.id) - viewRank(b.id))
}

/**
 * Enabled widgets in the order they are laid out on `bp`. When the user arranged this breakpoint
 * (saved positions exist) their order wins — placed widgets first, by y then x, newcomers after them in
 * hierarchy order. Otherwise the hierarchy order (`VIEW_ORDER`) is used.
 */
export function orderForBreakpoint(widgets: WidgetLayout[], bp: Breakpoint): WidgetLayout[] {
  const enabled = widgets.filter((w) => w.enabled)
  const placed = enabled.filter((w) => w.positions[bp])
  if (placed.length === 0) return sortForView(enabled)
  const byPosition = [...placed].sort((a, b) => {
    const pa = a.positions[bp]!
    const pb = b.positions[bp]!
    return pa.y - pb.y || pa.x - pb.x
  })
  return [...byPosition, ...sortForView(enabled.filter((w) => !w.positions[bp]))]
}

export type StackItem =
  | { kind: 'widget'; widget: WidgetLayout }
  | { kind: 'tiles'; widgets: WidgetLayout[] }

/** Phone stack: consecutive numeric tiles are grouped into one compact row, everything else is a full-width block. */
export function groupStack(list: WidgetLayout[]): StackItem[] {
  const out: StackItem[] = []
  for (const widget of list) {
    if (TILE_IDS.has(widget.id)) {
      const last = out[out.length - 1]
      if (last?.kind === 'tiles') last.widgets.push(widget)
      else out.push({ kind: 'tiles', widgets: [widget] })
    } else {
      out.push({ kind: 'widget', widget })
    }
  }
  return out
}

function clampToCols(pos: WidgetPosition, cols: number): WidgetPosition {
  const w = Math.min(Math.max(Math.round(pos.w), 1), cols)
  const x = Math.min(Math.max(Math.round(pos.x), 0), cols - w)
  return { x, y: Math.max(Math.round(pos.y), 0), w, h: Math.max(Math.round(pos.h), 1) }
}

function compactHeight(def: WidgetDefinition): number {
  return def.id === 'calendar' ? 16 : Math.max(def.minH, 4)
}

/** Tablet (8 columns): saved 2D positions when present, otherwise full-width blocks in hierarchy order. */
function tabletLayout(widgets: WidgetLayout[]): Layout {
  const cols = DASHBOARD_COLS.md
  return orderForBreakpoint(widgets, 'md').map((w, index) => {
    const def = defOf(w.id)
    const saved = w.positions.md ? clampToCols(w.positions.md, cols) : undefined
    return {
      i: w.id,
      x: saved?.x ?? 0,
      y: saved?.y ?? index * 5,
      w: saved?.w ?? cols,
      h: saved?.h ?? compactHeight(def),
      minW: Math.min(def.minW, cols),
      minH: def.minH,
    }
  })
}

/** Phones: strictly one column; `y` is cumulative so the rendered order is exactly `orderForBreakpoint`. */
function singleColumnLayout(widgets: WidgetLayout[], bp: 'sm' | 'xs'): Layout {
  const cols = DASHBOARD_COLS[bp]
  let y = 0
  return orderForBreakpoint(widgets, bp).map((w) => {
    const def = defOf(w.id)
    const h = Math.max(Math.round(w.positions[bp]?.h ?? compactHeight(def)), 1)
    const item = { i: w.id, x: 0, y, w: cols, h, minW: Math.min(def.minW, cols), minH: def.minH }
    y += h
    return item
  })
}

export function makeLayouts(widgets: WidgetLayout[]): ResponsiveLayouts<Breakpoint> {
  const lg: Layout = widgets.filter((w) => w.enabled).map((w) => {
    const def = defOf(w.id)
    return { i: w.id, ...clampToCols(w.positions.lg ?? def.defaultPosition, DASHBOARD_COLS.lg), minW: def.minW, minH: def.minH }
  })
  return { lg, md: tabletLayout(widgets), sm: singleColumnLayout(widgets, 'sm'), xs: singleColumnLayout(widgets, 'xs') }
}

/** Writes the positions RGL reports for breakpoint `bp` into the widget list (pure). */
export function applyGridLayout(widgets: WidgetLayout[], bp: Breakpoint, items: Layout): WidgetLayout[] {
  return widgets.map((w) => {
    const item = items.find((it) => it.i === w.id)
    if (!item) return w
    return { ...w, positions: { ...w.positions, [bp]: { x: item.x, y: item.y, w: item.w, h: item.h } } }
  })
}

const PRESET_SIZE: Record<SizePreset, Pick<WidgetPosition, 'w' | 'h'>> = {
  compact: { w: 3, h: 4 },
  wide: { w: 6, h: 6 },
  large: { w: 12, h: 9 },
}

/** Size for a preset, never below the widget's own minimum (a 3×4 calendar would be unusable). */
export function presetSize(id: WidgetId, preset: SizePreset): Pick<WidgetPosition, 'w' | 'h'> {
  const def = defOf(id)
  const base = PRESET_SIZE[preset]
  const h = preset === 'large' && id === 'calendar' ? 18 : base.h
  return { w: Math.max(base.w, def.minW), h: Math.max(h, def.minH) }
}

/** Desktop size presets («Компакт» / «Широкий» / «Большой»); other breakpoints are arranged by dragging. */
export function applyPreset(widgets: WidgetLayout[], id: WidgetId, preset: SizePreset): WidgetLayout[] {
  const size = presetSize(id, preset)
  return widgets.map((w) => w.id !== id ? w : {
    ...w,
    positions: { ...w.positions, lg: { ...(w.positions.lg ?? defOf(id).defaultPosition), ...size } },
  })
}

/** Deep copy with a canonical key order, so `layoutsEqual` never depends on object-key ordering. */
export function cloneLayout(widgets: WidgetLayout[]): WidgetLayout[] {
  return widgets.map((w) => {
    const positions: Partial<Record<Breakpoint, WidgetPosition>> = {}
    for (const bp of BREAKPOINT_ORDER) {
      const p = w.positions[bp]
      if (p) positions[bp] = { x: p.x, y: p.y, w: p.w, h: p.h }
    }
    return { id: w.id, enabled: w.enabled, positions }
  })
}

export function layoutsEqual(a: WidgetLayout[], b: WidgetLayout[]): boolean {
  return JSON.stringify(cloneLayout(a)) === JSON.stringify(cloneLayout(b))
}

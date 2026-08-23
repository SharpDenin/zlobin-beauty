import type { Layout, LayoutItem, ResponsiveLayouts } from 'react-grid-layout'

export type WidgetId =
  | 'alerts'
  | 'calendar'
  | 'today'
  | 'upcoming'
  | 'pending'
  | 'messages'
  | 'tasks'
  | 'clients_today'
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

export type WidgetDefinition = {
  id: WidgetId
  title: string
  defaultPosition: WidgetPosition
  minW: number
  minH: number
}

export const LIBRARY: WidgetDefinition[] = [
  { id: 'alerts', title: 'Важное', defaultPosition: { x: 0, y: 0, w: 12, h: 5 }, minW: 6, minH: 3 },
  { id: 'calendar', title: 'Календарь', defaultPosition: { x: 0, y: 5, w: 12, h: 18 }, minW: 8, minH: 10 },
  { id: 'today', title: 'Сегодня', defaultPosition: { x: 0, y: 23, w: 3, h: 4 }, minW: 2, minH: 3 },
  { id: 'pending', title: 'Ожидают подтверждения', defaultPosition: { x: 3, y: 23, w: 3, h: 4 }, minW: 2, minH: 3 },
  { id: 'clients_today', title: 'Клиенты сегодня', defaultPosition: { x: 6, y: 23, w: 3, h: 4 }, minW: 2, minH: 3 },
  { id: 'messages', title: 'Сообщения', defaultPosition: { x: 9, y: 23, w: 3, h: 4 }, minW: 2, minH: 3 },
  { id: 'upcoming', title: 'Ближайшие записи', defaultPosition: { x: 0, y: 27, w: 6, h: 8 }, minW: 4, minH: 5 },
  { id: 'analytics', title: 'Моя статистика', defaultPosition: { x: 6, y: 27, w: 6, h: 8 }, minW: 4, minH: 5 },
  { id: 'tasks', title: 'Задачи', defaultPosition: { x: 0, y: 35, w: 4, h: 5 }, minW: 3, minH: 4 },
  { id: 'orders', title: 'Заказы', defaultPosition: { x: 4, y: 35, w: 4, h: 5 }, minW: 3, minH: 4 },
  { id: 'deliveries', title: 'Доставки', defaultPosition: { x: 8, y: 35, w: 4, h: 5 }, minW: 3, minH: 4 },
]

export const DEFAULT_IDS: WidgetId[] = ['alerts', 'calendar', 'today', 'pending', 'clients_today', 'upcoming', 'analytics']

export function normalizeLayout(raw: unknown): WidgetLayout[] {
  const items = Array.isArray(raw) ? raw : []
  const parsed: WidgetLayout[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    if (rec.id === 'calendar_colors') continue
    const id = (rec.id === 'important_messages' ? 'alerts' : rec.id) as WidgetId
    const def = LIBRARY.find((w) => w.id === id)
    if (!def) continue
    const positions = rec.positions && typeof rec.positions === 'object'
      ? rec.positions as Partial<Record<Breakpoint, WidgetPosition>>
      : { lg: legacyPosition(rec, def) }
    parsed.push({ id, enabled: rec.enabled !== false, positions })
  }
  for (const id of DEFAULT_IDS) {
    if (!parsed.some((w) => w.id === id)) {
      const def = LIBRARY.find((w) => w.id === id)!
      parsed.push({ id, enabled: true, positions: { lg: def.defaultPosition } })
    }
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
  const fromType = rec.type === 'important_messages' ? 'alerts' : rec.type
  const typeDef = LIBRARY.find((w) => w.id === fromType)
  const base = typeDef && !rec.id ? typeDef.defaultPosition : def.defaultPosition
  return { ...base, ...(sizes[String(rec.size)] ?? {}), ...(Number.isFinite(rec.x) ? { x: Number(rec.x) } : {}), ...(Number.isFinite(rec.y) ? { y: Number(rec.y) } : {}), ...(Number.isFinite(rec.w) ? { w: Number(rec.w) } : {}), ...(Number.isFinite(rec.h) ? { h: Number(rec.h) } : {}) }
}

export function makeLayouts(widgets: WidgetLayout[]): ResponsiveLayouts<Breakpoint> {
  const lg: Layout = widgets.filter((w) => w.enabled).map((w) => {
    const def = LIBRARY.find((d) => d.id === w.id)!
    return { i: w.id, ...(w.positions.lg ?? def.defaultPosition), minW: def.minW, minH: def.minH }
  })
  const compact = (cols: number): Layout => widgets.filter((w) => w.enabled).map((w, index) => {
    const def = LIBRARY.find((d) => d.id === w.id)!
    const saved = w.positions[cols === 8 ? 'md' : cols === 4 ? 'sm' : 'xs']
    return {
      i: w.id,
      x: saved?.x ?? 0,
      y: saved?.y ?? index * 5,
      w: saved?.w ?? cols,
      h: saved?.h ?? (w.id === 'calendar' ? 16 : Math.max(def.minH, 4)),
      minW: Math.min(def.minW, cols),
      minH: def.minH,
    }
  })
  return { lg, md: compact(8), sm: compact(4), xs: compact(1) }
}

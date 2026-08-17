import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import ruLocale from '@fullcalendar/core/locales/ru'
import type { DatesSetArg, EventClickArg, EventContentArg, EventDropArg, EventInput } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useBuyerOrg } from '@/shared/lib/commerce'
import { useCabinet } from '@/shared/lib/cabinet'
import { statusLabel } from '@/shared/lib/status'
import { datetimeLocalToIso } from '@/shared/lib/time'
import { Hint } from '@/shared/ui/Hint'

type Appointment = {
  id: string
  service_name: string
  status: string
  starts_at: string
  ends_at: string
  master_user_id: string
  client_user_id: string
  branch_id: string
  location_name?: string
  location_address?: string
  booking_mode?: string
}

type PlannerBlock = {
  id: string
  title: string
  starts_at: string
  ends_at: string
  category: string
  color?: string
}

type Category = { id: string; label: string; color: string; icon: string; system?: boolean }
type CalendarSelection = {
  id: string
  kind: 'appointment' | 'block'
  title: string
  category: string
  status?: string
  start: Date | null
  end: Date | null
  location?: string
  master?: string
}

const MASTER_CATEGORIES: Category[] = [
  { id: 'client', label: 'Клиент', color: '#2f6f78', icon: '✦', system: true },
  { id: 'personal', label: 'Личное', color: '#8f6a55', icon: '●' },
  { id: 'break', label: 'Перерыв', color: '#748079', icon: 'Ⅱ' },
  { id: 'blocked', label: 'Заблокировано', color: '#525c65', icon: '◆' },
  { id: 'task', label: 'Задача', color: '#55785f', icon: '✓' },
  { id: 'delivery', label: 'Получение / доставка', color: '#6b5d91', icon: '→' },
]

const REP_CATEGORIES: Category[] = [
  { id: 'delivery', label: 'Доставка', color: '#2f6f78', icon: '→' },
  { id: 'salon_visit', label: 'Посещение салона', color: '#55785f', icon: '⌂' },
  { id: 'task', label: 'Задача', color: '#8f6a55', icon: '✓' },
  { id: 'personal', label: 'Личное', color: '#748079', icon: '●' },
]

const ADMIN_CATEGORIES: Category[] = [
  { id: 'client', label: 'Запись клиента', color: '#2f6f78', icon: '✦', system: true },
  { id: 'task', label: 'Задача', color: '#55785f', icon: '✓' },
  { id: 'operational', label: 'Операционное', color: '#8f6a55', icon: '◆' },
  { id: 'staff', label: 'Сотрудники', color: '#6b5d91', icon: '◎' },
]

function categoriesFor(kind: string): Category[] {
  if (kind === 'supplier_rep') return REP_CATEGORIES
  if (kind === 'salon_admin' || kind === 'salon_owner' || kind === 'chain_owner') return ADMIN_CATEGORIES
  return MASTER_CATEGORIES
}

function eventCard(info: EventContentArg) {
  const category = String(info.event.extendedProps.categoryLabel ?? '')
  const status = String(info.event.extendedProps.statusLabel ?? '')
  const secondary = String(info.event.extendedProps.secondary ?? '')
  return (
    <div className="calendar-event-card">
      <div className="calendar-event-time">{info.timeText}</div>
      <strong>{info.event.title}</strong>
      <div className="calendar-event-meta">
        {category && <span>{info.event.extendedProps.icon} {category}</span>}
        {status && <span>{status}</span>}
      </div>
      {secondary && <span className="calendar-event-secondary">{secondary}</span>}
    </div>
  )
}

function initialRange() {
  const start = new Date()
  start.setDate(start.getDate() - 7)
  const end = new Date()
  end.setDate(end.getDate() + 45)
  return { from: start.toISOString(), to: end.toISOString() }
}

export function CalendarPage({ embedded = false }: { embedded?: boolean }) {
  const { accessToken, user } = useAuth()
  const { buyerOrg } = useBuyerOrg()
  const cabinet = useCabinet()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const calendarRef = useRef<FullCalendar | null>(null)
  const salonTimezone = buyerOrg?.branches[0]?.timezone || 'Europe/Moscow'
  const basePalette = categoriesFor(cabinet.kind)
  const ownerMode = ['salon_owner', 'chain_owner', 'salon_admin'].includes(cabinet.kind)
  const orgID = cabinet.selectedOrg?.organization.id ?? buyerOrg?.organization.id
  const [range, setRange] = useState(initialRange)
  const [currentView, setCurrentView] = useState(() => (typeof window !== 'undefined' && window.innerWidth <= 600 ? 'timeGridDay' : 'timeGridWeek'))
  const [hidden, setHidden] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selected, setSelected] = useState<CalendarSelection | null>(null)
  const [masterFilter, setMasterFilter] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [blockTitle, setBlockTitle] = useState('Личное время')
  const [blockCat, setBlockCat] = useState(basePalette.find((c) => !c.system)?.id ?? 'personal')
  const [blockStart, setBlockStart] = useState('')
  const [blockEnd, setBlockEnd] = useState('')

  const dashboard = useQuery({
    queryKey: ['me-dashboard'],
    queryFn: () => apiRequest<{ widgets: unknown }>('/v1/me/dashboard', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const rawWidgets = Array.isArray(dashboard.data?.widgets) ? dashboard.data.widgets as Array<Record<string, unknown>> : []
  const savedColors = (rawWidgets.find((x) => x.id === 'calendar_colors')?.colors ?? {}) as Record<string, string>
  const palette = useMemo(
    () => basePalette.map((c) => ({ ...c, color: c.system ? c.color : savedColors[c.id] || c.color })),
    [basePalette, savedColors],
  )

  const colorSave = useMutation({
    mutationFn: ({ category, color }: { category: string; color: string }) => {
      const rest = rawWidgets.filter((x) => x.id !== 'calendar_colors')
      return apiRequest('/v1/me/dashboard', {
        method: 'PUT',
        token: accessToken,
        body: { widgets: [...rest, { id: 'calendar_colors', colors: { ...savedColors, [category]: color } }] },
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me-dashboard'] }),
  })

  const appointments = useQuery({
    queryKey: ['calendar-appointments', ownerMode, orgID, range.from, range.to],
    queryFn: () => ownerMode
      ? apiRequest<{ items: Appointment[] }>(
        `/v1/calendar/appointments?organization_id=${orgID}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
        { token: accessToken },
      )
      : apiRequest<{ items: Appointment[] }>('/v1/appointments/mine?role=master', { token: accessToken }),
    enabled: Boolean(accessToken && (!ownerMode || orgID)) && cabinet.kind !== 'supplier_rep',
  })

  const blocks = useQuery({
    queryKey: ['planner-blocks', range.from, range.to],
    queryFn: () => apiRequest<{ items: PlannerBlock[] }>(
      `/v1/planner/blocks?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      { token: accessToken },
    ),
    enabled: Boolean(accessToken),
  })

  const masterIDs = useMemo(
    () => [...new Set((appointments.data?.items ?? []).map((a) => a.master_user_id))].sort(),
    [appointments.data],
  )
  const masters = useQuery({
    queryKey: ['calendar-master-names', masterIDs.join(',')],
    queryFn: async () => {
      const entries = await Promise.all(masterIDs.map(async (id) => {
        try {
          const res = await apiRequest<{ master: { display_name: string } }>(`/v1/masters/${id}`)
          return [id, res.master.display_name] as const
        } catch {
          return [id, `Мастер ${id.slice(0, 6)}`] as const
        }
      }))
      return Object.fromEntries(entries) as Record<string, string>
    },
    enabled: masterIDs.length > 0,
  })

  function category(id: string) {
    return palette.find((c) => c.id === id) ?? { id, label: id, color: '#66747a', icon: '•' }
  }

  const events: EventInput[] = useMemo(() => {
    const out: EventInput[] = []
    for (const a of appointments.data?.items ?? []) {
      if (hidden.includes('client') || (masterFilter && a.master_user_id !== masterFilter) || (branchFilter && a.branch_id !== branchFilter)) continue
      const cat = category('client')
      const masterName = masters.data?.[a.master_user_id]
      const canMove = !ownerMode && a.master_user_id === user?.id && a.booking_mode !== 'fixed_window'
      out.push({
        id: `appt:${a.id}`,
        title: a.service_name,
        start: a.starts_at,
        end: a.ends_at,
        backgroundColor: cat.color,
        borderColor: cat.color,
        editable: canMove,
        durationEditable: false,
        extendedProps: {
          kind: 'appointment',
          category: 'client',
          categoryLabel: cat.label,
          icon: cat.icon,
          status: a.status,
          statusLabel: statusLabel(a.status),
          secondary: [masterName, a.location_name].filter(Boolean).join(' · '),
          location: [a.location_name, a.location_address].filter(Boolean).join(', '),
          master: masterName,
        },
      })
    }
    for (const b of blocks.data?.items ?? []) {
      const cat = category(b.category || 'personal')
      if (hidden.includes(cat.id)) continue
      out.push({
        id: `block:${b.id}`,
        title: b.title,
        start: b.starts_at,
        end: b.ends_at,
        backgroundColor: b.color || cat.color,
        borderColor: b.color || cat.color,
        editable: true,
        durationEditable: true,
        extendedProps: { kind: 'block', category: cat.id, categoryLabel: cat.label, icon: cat.icon },
      })
    }
    return out
  // category reads the memoized palette and is intentionally resolved for each event.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments.data, blocks.data, hidden, masterFilter, branchFilter, masters.data, ownerMode, palette, user?.id])

  const createBlock = useMutation({
    mutationFn: () => apiRequest('/v1/planner/blocks', {
      token: accessToken,
      body: {
        title: blockTitle.trim() || 'Событие',
        category: blockCat,
        starts_at: datetimeLocalToIso(blockStart, salonTimezone),
        ends_at: datetimeLocalToIso(blockEnd, salonTimezone),
        timezone: salonTimezone,
        color: category(blockCat).color,
        organization_id: orgID,
      },
    }),
    onSuccess: async () => {
      setEditorOpen(false)
      setOk('Событие добавлено в календарь')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['planner-blocks'] })
    },
    onError: (e) => setError(calendarError(e, 'Не удалось создать событие')),
  })

  const removeBlock = useMutation({
    mutationFn: (id: string) => apiRequest(`/v1/planner/blocks/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      setSelected(null)
      setOk('Событие удалено')
      await qc.invalidateQueries({ queryKey: ['planner-blocks'] })
    },
  })

  async function persistMove(id: string, start: Date | null, end: Date | null, resized: boolean) {
    if (!start || !end) return false
    try {
      if (id.startsWith('block:')) {
        await apiRequest(`/v1/planner/blocks/${id.slice(6)}`, {
          method: 'PATCH',
          token: accessToken,
          body: { starts_at: start.toISOString(), ends_at: end.toISOString() },
        })
        await qc.invalidateQueries({ queryKey: ['planner-blocks'] })
        setOk(resized ? 'Длительность обновлена' : 'Событие перенесено')
      } else if (id.startsWith('appt:')) {
        await apiRequest(`/v1/appointments/${id.slice(5)}/reschedule`, {
          token: accessToken,
          body: { starts_at: start.toISOString() },
        })
        await qc.invalidateQueries({ queryKey: ['calendar-appointments'] })
        setOk('Запись перенесена')
      }
      setError(null)
      return true
    } catch (e) {
      setError(calendarError(e, 'Изменение отменено'))
      return false
    }
  }

  async function onDrop(info: EventDropArg) {
    if (!await persistMove(info.event.id, info.event.start, info.event.end, false)) info.revert()
  }

  async function onResize(info: EventResizeDoneArg) {
    if (info.event.id.startsWith('appt:')) {
      info.revert()
      setError('Длительность записи определяется выбранной услугой')
      return
    }
    if (!await persistMove(info.event.id, info.event.start, info.event.end, true)) info.revert()
  }

  function onEventClick(info: EventClickArg) {
    const p = info.event.extendedProps
    setSelected({
      id: info.event.id,
      kind: p.kind,
      title: info.event.title,
      category: p.categoryLabel,
      status: p.statusLabel,
      start: info.event.start,
      end: info.event.end,
      location: p.location,
      master: p.master,
    })
  }

  function onDatesSet(info: DatesSetArg) {
    setCurrentView(info.view.type)
    const next = { from: info.start.toISOString(), to: info.end.toISOString() }
    setRange((current) => current.from === next.from && current.to === next.to ? current : next)
  }

  const salonBranches = cabinet.selectedOrg?.branches ?? buyerOrg?.branches ?? []
  const body = (
    <div className="stack calendar-shell">
      {!embedded && (
        <div className="calendar-page-head">
          <div className="stack-sm">
            <p className="eyebrow">Расписание</p>
            <h1>{ownerMode ? 'Календарь салона' : 'Мой календарь'}</h1>
            <p className="muted">
              Переносите события мышкой или касанием — при конфликте изменение отменится.
              <Hint id="cal-dnd" title="Работа с расписанием">Личные события можно переносить и растягивать. Длительность записи задаёт услуга.</Hint>
            </p>
          </div>
          <div className="row">
            <Link className="btn btn-secondary btn-compact" to="/master">Рабочие часы</Link>
            <button className="btn btn-primary btn-compact" type="button" onClick={() => setEditorOpen(true)}>+ Событие</button>
          </div>
        </div>
      )}

      {error && <div className="state-box error" role="alert">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      {ownerMode && (
        <section className="calendar-resource-bar">
          <div className="field">
            <label>Мастер</label>
            <select value={masterFilter} onChange={(e) => setMasterFilter(e.target.value)}>
              <option value="">Все мастера</option>
              {masterIDs.map((id) => <option key={id} value={id}>{masters.data?.[id] ?? `Мастер ${id.slice(0, 6)}`}</option>)}
            </select>
          </div>
          {(cabinet.kind === 'chain_owner' || salonBranches.length > 1) && (
            <div className="field">
              <label>Филиал</label>
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
                <option value="">Все филиалы</option>
                {salonBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
        </section>
      )}

      <div className="calendar-controls">
        <div className="calendar-view-tabs" aria-label="Режим календаря">
          {[
            ['timeGridDay', 'День'],
            ['timeGridWeek', 'Неделя'],
            ['dayGridMonth', 'Месяц'],
            ['listWeek', 'Список'],
          ].map(([id, label]) => (
            <button key={id} type="button" className={`chip ${currentView === id ? 'active' : ''}`} onClick={() => calendarRef.current?.getApi().changeView(id)}>
              {label}
            </button>
          ))}
        </div>
        <button className="btn-link" type="button" onClick={() => setSettingsOpen((v) => !v)}>Цвета и категории</button>
      </div>

      <div className="calendar-category-row">
        {palette.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`calendar-category-chip ${hidden.includes(c.id) ? 'is-hidden' : ''}`}
            onClick={() => setHidden((h) => h.includes(c.id) ? h.filter((x) => x !== c.id) : [...h, c.id])}
          >
            <span style={{ backgroundColor: c.color }}>{c.icon}</span>{c.label}
          </button>
        ))}
      </div>

      {settingsOpen && (
        <section className="card calendar-color-settings">
          <div><strong>Цвета календаря</strong><p className="muted">Системный цвет записи фиксирован. Остальные сохраняются для вашего профиля.</p></div>
          <div className="calendar-color-grid">
            {palette.map((c) => (
              <label key={c.id} className={c.system ? 'is-disabled' : ''}>
                <input type="color" value={c.color} disabled={c.system || colorSave.isPending} onChange={(e) => colorSave.mutate({ category: c.id, color: e.target.value })} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      <div className="calendar-wrap">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView={typeof window !== 'undefined' && window.innerWidth <= 600 ? 'timeGridDay' : 'timeGridWeek'}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
          locale={ruLocale}
          height="auto"
          editable
          eventDurationEditable
          eventStartEditable
          slotMinTime="08:00:00"
          slotMaxTime="22:00:00"
          allDaySlot={false}
          nowIndicator
          stickyHeaderDates
          dayMaxEvents={3}
          slotEventOverlap={false}
          eventMaxStack={4}
          events={events}
          eventContent={eventCard}
          eventDrop={onDrop}
          eventResize={onResize}
          eventClick={onEventClick}
          datesSet={onDatesSet}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          buttonText={{ today: 'Сегодня' }}
        />
      </div>

      {editorOpen && (
        <div className="more-drawer" role="dialog" aria-modal="true" onClick={() => setEditorOpen(false)}>
          <div className="more-panel stack" onClick={(e) => e.stopPropagation()}>
            <div className="row between"><div><p className="eyebrow">Календарь</p><h2>Новое событие</h2></div><button className="btn btn-secondary btn-compact" type="button" onClick={() => setEditorOpen(false)}>Закрыть</button></div>
            <div className="field"><label>Название</label><input value={blockTitle} onChange={(e) => setBlockTitle(e.target.value)} autoFocus /></div>
            <div className="field"><label>Категория</label><select value={blockCat} onChange={(e) => setBlockCat(e.target.value)}>{palette.filter((c) => !c.system).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
            <div className="field"><label>Начало</label><input type="datetime-local" value={blockStart} onChange={(e) => setBlockStart(e.target.value)} /></div>
            <div className="field"><label>Конец</label><input type="datetime-local" value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)} /></div>
            <button className="btn btn-primary" type="button" disabled={createBlock.isPending || !blockStart || !blockEnd} onClick={() => createBlock.mutate()}>
              {createBlock.isPending ? 'Сохраняем…' : 'Добавить в календарь'}
            </button>
          </div>
        </div>
      )}

      {selected && (
        <div className="more-drawer calendar-detail-drawer" role="dialog" aria-modal="true" onClick={() => setSelected(null)}>
          <div className="more-panel stack" onClick={(e) => e.stopPropagation()}>
            <div className="row between"><p className="eyebrow">{selected.category}</p><button className="btn btn-secondary btn-compact" type="button" onClick={() => setSelected(null)}>Закрыть</button></div>
            <h2>{selected.title}</h2>
            <div className="calendar-detail-time">{selected.start?.toLocaleString('ru-RU')} — {selected.end?.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
            {selected.status && <span className="badge">{selected.status}</span>}
            {selected.master && <p><strong>Мастер:</strong> {selected.master}</p>}
            {selected.location && <p><strong>Место:</strong> {selected.location}</p>}
            {selected.kind === 'appointment' && <button className="btn btn-primary" type="button" onClick={() => navigate(`/appointments/${selected.id.slice(5)}`)}>Открыть запись</button>}
            {selected.kind === 'block' && <button className="btn btn-danger" type="button" disabled={removeBlock.isPending} onClick={() => removeBlock.mutate(selected.id.slice(6))}>Удалить событие</button>}
          </div>
        </div>
      )}
    </div>
  )

  if (embedded) return body
  return <main className="page stack">{body}</main>
}

function calendarError(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.status === 409) return 'На это время уже запланировано другое событие'
  if (error instanceof ApiError && error.status === 403) return 'У вас нет прав на изменение этого события'
  return error instanceof ApiError ? error.message : fallback
}

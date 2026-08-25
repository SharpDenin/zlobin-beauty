import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import luxonPlugin from '@fullcalendar/luxon3'
import ruLocale from '@fullcalendar/core/locales/ru'
import type { DatesSetArg, EventClickArg, EventContentArg, EventDropArg, EventInput } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { tokens } from '@/shared/ui/tokens'
import { statusLabel } from '@/shared/lib/status'
import { datetimeLocalToIso, isoToDatetimeLocal } from '@/shared/lib/time'
import { Hint } from '@/shared/ui/Hint'
import { canDragAppointment, isTerminalStatus, minutesToTime, staffRoleLabel } from '@/pages/calendar-helpers'
import { CalendarAvailability } from '@/pages/CalendarAvailability'

type Appointment = {
  id: string
  service_id?: string
  service_name: string
  status: string
  starts_at: string
  ends_at: string
  organization_id?: string
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
  owner_user_id?: string
}

type StaffMember = { id: string; user_id: string; role: string; status: string }
type HoursItem = { weekday: number; start_minute: number; end_minute: number }
type ExceptionItem = { id: string; day: string; is_day_off: boolean; start_minute?: number | null; end_minute?: number | null; note?: string }

type Category = { id: string; label: string; color: string; icon: string; system?: boolean }
type CalendarSelection = {
  id: string
  kind: 'appointment' | 'block'
  title: string
  category: string
  categoryId?: string
  status?: string
  start: Date | null
  end: Date | null
  location?: string
  master?: string
  color?: string
  serviceId?: string
  organizationId?: string
  masterUserId?: string
}

const MASTER_CATEGORIES: Category[] = [
  { id: 'client', label: 'Клиент', color: tokens.color.primary, icon: '✦', system: true },
  { id: 'personal', label: 'Личное', color: tokens.color.textSecondary, icon: '●' },
  { id: 'break', label: 'Перерыв', color: '#6B7385', icon: 'Ⅱ' },
  { id: 'blocked', label: 'Заблокировано', color: tokens.color.danger, icon: '◆' },
  { id: 'task', label: 'Задача', color: tokens.color.success, icon: '✓' },
  { id: 'delivery', label: 'Получение / доставка', color: tokens.color.primarySoft, icon: '→' },
]

const REP_CATEGORIES: Category[] = [
  { id: 'delivery', label: 'Доставка', color: tokens.color.primary, icon: '→' },
  { id: 'salon_visit', label: 'Посещение салона', color: tokens.color.success, icon: '⌂' },
  { id: 'task', label: 'Задача', color: tokens.color.primarySoft, icon: '✓' },
  { id: 'personal', label: 'Личное', color: tokens.color.textSecondary, icon: '●' },
]

const ADMIN_CATEGORIES: Category[] = [
  { id: 'client', label: 'Запись клиента', color: tokens.color.primary, icon: '✦', system: true },
  { id: 'task', label: 'Задача', color: tokens.color.success, icon: '✓' },
  { id: 'operational', label: 'Операционное', color: tokens.color.warning, icon: '◆' },
  { id: 'staff', label: 'Сотрудники', color: tokens.color.primarySoft, icon: '◎' },
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

export function CalendarPage({ embedded = false, overlayRepId }: { embedded?: boolean; overlayRepId?: string }) {
  const { accessToken, user } = useAuth()
  const cabinet = useCabinet()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const calendarRef = useRef<FullCalendar | null>(null)
  const isRepPlanner = cabinet.kind === 'supplier_rep' || Boolean(overlayRepId)
  const basePalette = isRepPlanner ? REP_CATEGORIES : categoriesFor(cabinet.kind)
  const ownerMode = ['salon_owner', 'chain_owner', 'salon_admin'].includes(cabinet.kind)
  const orgID = cabinet.selectedOrg?.organization.id
  const salonBranches = cabinet.selectedOrg?.branches ?? []
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
  const [blockColor, setBlockColor] = useState('')

  const selectedBranch = salonBranches.find((b) => b.id === branchFilter) ?? salonBranches[0]
  const salonTimezone = selectedBranch?.timezone || 'Europe/Moscow'

  useEffect(() => {
    setMasterFilter('')
    setBranchFilter(cabinet.selectedBranch?.id ?? '')
  }, [orgID, cabinet.selectedBranch?.id])

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

  const workModes = useQuery({
    queryKey: ['calendar-work-modes', ownerMode, orgID, range.from, range.to, masterFilter],
    queryFn: () => {
      const qs = new URLSearchParams({ from: range.from, to: range.to })
      if (ownerMode && orgID) qs.set('organization_id', orgID)
      if (masterFilter) qs.set('master_user_id', masterFilter)
      return apiRequest<{ items: Array<{ id: string; mode: string; mode_label: string; starts_at: string; ends_at: string; location_label?: string; master_user_id: string }> }>(
        `/v1/calendar/work-mode-intervals?${qs.toString()}`,
        { token: accessToken },
      )
    },
    enabled: Boolean(accessToken),
  })

  const appointments = useQuery({
    queryKey: ['calendar-appointments', ownerMode, orgID, range.from, range.to],
    queryFn: () => ownerMode
      ? apiRequest<{ items: Appointment[] }>(
        `/v1/calendar/appointments?organization_id=${orgID}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
        { token: accessToken },
      )
      : apiRequest<{ items: Appointment[] }>(
        `/v1/appointments/mine?role=master&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && (!ownerMode || orgID)) && cabinet.kind !== 'supplier_rep',
  })

  const blocks = useQuery({
    queryKey: ['planner-blocks', range.from, range.to, ownerMode ? orgID : ''],
    queryFn: () => apiRequest<{ items: PlannerBlock[] }>(
      `/v1/planner/blocks?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}${ownerMode && orgID ? `&organization_id=${orgID}` : ''}`,
      { token: accessToken },
    ),
    enabled: Boolean(accessToken && (!ownerMode || orgID)),
  })
  const fieldTasks = useQuery({
    queryKey: ['planner-field-tasks', orgID, overlayRepId],
    queryFn: () => {
      const qs = overlayRepId ? `representative_id=${overlayRepId}` : ''
      return apiRequest<{ items: Array<{ id: string; title: string; due_at?: string; planner_category?: string; kind?: string; status: string }> }>(
        `/v1/organizations/${orgID}/tasks${qs ? `?${qs}` : ''}`,
        { token: accessToken },
      )
    },
    enabled: Boolean(accessToken && orgID && (cabinet.kind === 'supplier_rep' || cabinet.kind === 'supplier' || Boolean(overlayRepId))),
  })

  const staff = useQuery({
    queryKey: ['calendar-staff', orgID],
    queryFn: () => apiRequest<{ items: StaffMember[] }>(`/v1/organizations/${orgID}/staff`, { token: accessToken }),
    enabled: Boolean(accessToken && ownerMode && orgID),
  })

  const hoursMaster = masterFilter || user?.id || ''
  const hours = useQuery({
    queryKey: ['calendar-hours', orgID, hoursMaster],
    queryFn: () => apiRequest<{ items: HoursItem[] }>(
      ownerMode && hoursMaster && hoursMaster !== user?.id
        ? `/v1/calendar/working-hours?organization_id=${orgID}&master_user_id=${hoursMaster}`
        : '/v1/me/working-hours',
      { token: accessToken },
    ),
    enabled: Boolean(accessToken),
  })
  const exceptions = useQuery({
    queryKey: ['calendar-exceptions', orgID, hoursMaster, range.from],
    queryFn: () => {
      const fromDay = range.from.slice(0, 10)
      const toDay = range.to.slice(0, 10)
      const qs = ownerMode && hoursMaster && hoursMaster !== user?.id
        ? `/v1/calendar/schedule-exceptions?organization_id=${orgID}&master_user_id=${hoursMaster}&from=${fromDay}&to=${toDay}`
        : `/v1/me/schedule-exceptions?from=${fromDay}&to=${toDay}`
      return apiRequest<{ items: ExceptionItem[] }>(qs, { token: accessToken })
    },
    enabled: Boolean(accessToken),
  })

  const staffMasters = useMemo(
    () => (staff.data?.items ?? []).filter((m) => m.status === 'active' && (m.role === 'master' || m.role === 'owner')),
    [staff.data],
  )
  const masterIDs = useMemo(() => {
    const fromAppts = (appointments.data?.items ?? []).map((a) => a.master_user_id)
    const fromStaff = staffMasters.map((m) => m.user_id)
    return [...new Set([...fromStaff, ...fromAppts].filter(Boolean))].sort()
  }, [appointments.data, staffMasters])

  const masters = useQuery({
    queryKey: ['calendar-master-names', masterIDs.join(',')],
    queryFn: async () => {
      const entries = await Promise.all(masterIDs.map(async (id) => {
        try {
          const res = await apiRequest<{ master: { display_name: string } }>(`/v1/masters/${id}`)
          return [id, res.master.display_name] as const
        } catch {
          const member = staffMasters.find((m) => m.user_id === id)
          return [id, staffRoleLabel(member?.role)] as const
        }
      }))
      return Object.fromEntries(entries) as Record<string, string>
    },
    enabled: masterIDs.length > 0,
  })

  function category(id: string) {
    return palette.find((c) => c.id === id) ?? { id, label: id, color: tokens.color.textSecondary, icon: '•' }
  }

  const businessHours = useMemo(() => {
    const items = hours.data?.items ?? []
    if (items.length === 0) return { daysOfWeek: [1, 2, 3, 4, 5, 6, 0], startTime: '08:00', endTime: '22:00' }
    return items.map((h) => ({
      daysOfWeek: [h.weekday],
      startTime: minutesToTime(h.start_minute),
      endTime: minutesToTime(h.end_minute),
    }))
  }, [hours.data])

  const slotMinTime = useMemo(() => {
    const items = hours.data?.items ?? []
    if (items.length === 0) return '08:00:00'
    return minutesToTime(Math.min(...items.map((h) => h.start_minute)))
  }, [hours.data])
  const slotMaxTime = useMemo(() => {
    const items = hours.data?.items ?? []
    if (items.length === 0) return '22:00:00'
    return minutesToTime(Math.max(...items.map((h) => h.end_minute)))
  }, [hours.data])

  const events: EventInput[] = useMemo(() => {
    const out: EventInput[] = []
    for (const a of appointments.data?.items ?? []) {
      if (hidden.includes('client') || (masterFilter && a.master_user_id !== masterFilter) || (branchFilter && a.branch_id !== branchFilter)) continue
      const cat = category('client')
      const masterName = masters.data?.[a.master_user_id] ?? staffRoleLabel('master')
      const terminal = isTerminalStatus(a.status)
      const canMove = canDragAppointment(a.status, a.booking_mode)
      out.push({
        id: `appt:${a.id}`,
        title: a.service_name,
        start: a.starts_at,
        end: a.ends_at,
        backgroundColor: cat.color,
        borderColor: cat.color,
        editable: canMove,
        durationEditable: false,
        classNames: terminal ? ['is-terminal'] : [],
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
          serviceId: a.service_id,
          organizationId: a.organization_id,
          masterUserId: a.master_user_id,
        },
      })
    }
    for (const b of blocks.data?.items ?? []) {
      const cat = category(b.category || 'personal')
      if (hidden.includes(cat.id)) continue
      if (masterFilter && b.owner_user_id && b.owner_user_id !== masterFilter) continue
      out.push({
        id: `block:${b.id}`,
        title: b.title,
        start: b.starts_at,
        end: b.ends_at,
        backgroundColor: b.color || cat.color,
        borderColor: b.color || cat.color,
        editable: true,
        durationEditable: true,
        classNames: ['is-planner-block'],
        extendedProps: { kind: 'block', category: cat.id, categoryLabel: cat.label, icon: cat.icon, color: b.color || cat.color },
      })
    }
    for (const t of fieldTasks.data?.items ?? []) {
      if (!t.due_at) continue
      const catId = t.planner_category || (t.kind === 'salon_visit' || t.kind === 'commercial_visit' ? 'salon_visit' : t.kind === 'delivery_support' ? 'delivery' : 'task')
      const cat = category(catId)
      if (hidden.includes(cat.id)) continue
      const start = new Date(t.due_at)
      out.push({
        id: `task:${t.id}`,
        title: t.title,
        start: start.toISOString(),
        end: new Date(start.getTime() + 45 * 60 * 1000).toISOString(),
        backgroundColor: cat.color,
        borderColor: cat.color,
        editable: false,
        extendedProps: { kind: 'block', category: cat.id, categoryLabel: cat.label, icon: cat.icon, status: t.status, statusLabel: t.status },
      })
    }
    for (const ex of exceptions.data?.items ?? []) {
      if (ex.is_day_off) {
        out.push({
          id: `off:${ex.id}`,
          title: ex.note || 'Выходной',
          start: ex.day,
          allDay: true,
          display: 'background',
          backgroundColor: 'rgba(239, 119, 119, 0.18)',
          editable: false,
        })
      }
    }
    for (const w of workModes.data?.items ?? []) {
      if (masterFilter && w.master_user_id && w.master_user_id !== masterFilter) continue
      out.push({
        id: `mode:${w.id}`,
        title: `${w.mode_label}${w.location_label ? ` · ${w.location_label}` : ''}`,
        start: w.starts_at,
        end: w.ends_at,
        backgroundColor: tokens.color.primaryMuted,
        borderColor: tokens.color.primary,
        editable: false,
        classNames: ['is-work-mode'],
        extendedProps: {
          kind: 'work-mode',
          category: w.mode,
          categoryLabel: w.mode_label,
          location: w.location_label,
        },
      })
    }
    return out
  // category reads the memoized palette and is intentionally resolved for each event.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments.data, blocks.data, fieldTasks.data, exceptions.data, workModes.data, hidden, masterFilter, branchFilter, masters.data, palette])

  const createBlock = useMutation({
    mutationFn: () => apiRequest('/v1/planner/blocks', {
      token: accessToken,
      body: {
        title: blockTitle.trim() || 'Событие',
        category: blockCat,
        starts_at: datetimeLocalToIso(blockStart, salonTimezone),
        ends_at: datetimeLocalToIso(blockEnd, salonTimezone),
        timezone: salonTimezone,
        color: blockColor || category(blockCat).color,
        organization_id: orgID,
        owner_user_id: ownerMode && masterFilter ? masterFilter : undefined,
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

  const saveBlock = useMutation({
    mutationFn: () => {
      if (!selected || selected.kind !== 'block') throw new Error('no block')
      return apiRequest(`/v1/planner/blocks/${selected.id.slice(6)}`, {
        method: 'PATCH',
        token: accessToken,
        body: {
          title: blockTitle.trim() || selected.title,
          category: blockCat,
          color: blockColor || category(blockCat).color,
          starts_at: datetimeLocalToIso(blockStart, salonTimezone),
          ends_at: datetimeLocalToIso(blockEnd, salonTimezone),
        },
      })
    },
    onSuccess: async () => {
      setSelected(null)
      setOk('Событие обновлено')
      await qc.invalidateQueries({ queryKey: ['planner-blocks'] })
    },
    onError: (e) => setError(calendarError(e, 'Не удалось сохранить событие')),
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
      const startsAt = start.toISOString()
      const endsAt = end.toISOString()
      if (id.startsWith('block:')) {
        await apiRequest(`/v1/planner/blocks/${id.slice(6)}`, {
          method: 'PATCH',
          token: accessToken,
          body: { starts_at: startsAt, ends_at: endsAt },
        })
        await qc.invalidateQueries({ queryKey: ['planner-blocks'] })
        setOk(resized ? 'Длительность обновлена' : 'Событие перенесено')
      } else if (id.startsWith('appt:')) {
        await apiRequest(`/v1/appointments/${id.slice(5)}/reschedule`, {
          token: accessToken,
          body: { starts_at: startsAt },
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
    if (info.event.display === 'background') return
    const p = info.event.extendedProps
    if (p.kind === 'work-mode') return
    const sel: CalendarSelection = {
      id: info.event.id,
      kind: p.kind,
      title: info.event.title,
      category: p.categoryLabel,
      categoryId: p.category,
      status: p.statusLabel,
      start: info.event.start,
      end: info.event.end,
      location: p.location,
      master: p.master,
      color: p.color,
      serviceId: p.serviceId,
      organizationId: p.organizationId,
      masterUserId: p.masterUserId,
    }
    setSelected(sel)
    if (sel.kind === 'block') {
      setBlockTitle(sel.title)
      setBlockCat(sel.categoryId || 'personal')
      setBlockColor(sel.color || category(sel.categoryId || 'personal').color)
      setBlockStart(sel.start ? isoToDatetimeLocal(sel.start.toISOString(), salonTimezone) : '')
      setBlockEnd(sel.end ? isoToDatetimeLocal(sel.end.toISOString(), salonTimezone) : '')
    }
  }

  function onDatesSet(info: DatesSetArg) {
    setCurrentView(info.view.type)
    const next = { from: info.start.toISOString(), to: info.end.toISOString() }
    setRange((current) => current.from === next.from && current.to === next.to ? current : next)
  }

  const body = (
    <div className="stack calendar-shell">
      {!embedded && (
        <div className="calendar-page-head">
          <div className="stack-sm">
            <p className="eyebrow">Расписание</p>
            <h1>{ownerMode ? 'Календарь салона' : 'Мой календарь'}</h1>
            <p className="muted">
              Часовой пояс: {salonTimezone}. Переносите события мышкой — при конфликте изменение отменится.
              <Hint id="cal-dnd" title="Работа с расписанием">Личные события можно переносить и растягивать. Длительность записи задаёт услуга. Завершённые и отменённые записи только для просмотра.</Hint>
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
              {masterIDs.map((id) => <option key={id} value={id}>{masters.data?.[id] ?? 'Мастер'}</option>)}
            </select>
          </div>
          {(cabinet.kind === 'chain_owner' || salonBranches.length > 1) && (
            <div className="field">
              <label>Филиал</label>
              <select
                value={branchFilter}
                onChange={(e) => {
                  setBranchFilter(e.target.value)
                  if (e.target.value) cabinet.setSelectedBranchId(e.target.value)
                }}
                data-testid="calendar-branch-switcher"
              >
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
          key={`${salonTimezone}-${orgID ?? 'self'}`}
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin]}
          initialView={typeof window !== 'undefined' && window.innerWidth <= 600 ? 'timeGridDay' : 'timeGridWeek'}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
          locale={ruLocale}
          timeZone={salonTimezone}
          height="auto"
          editable
          eventDurationEditable
          eventStartEditable
          eventAllow={(_span, moving) => {
            if (!moving) return true
            if (String(moving.id).startsWith('appt:')) return canDragAppointment(String(moving.extendedProps.status ?? ''))
            return true
          }}
          slotMinTime={slotMinTime}
          slotMaxTime={slotMaxTime}
          businessHours={businessHours}
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
            <div className="field"><label>Цвет</label><input type="color" value={blockColor || category(blockCat).color} onChange={(e) => setBlockColor(e.target.value)} /></div>
            <div className="field"><label>Начало</label><input type="datetime-local" value={blockStart} onChange={(e) => setBlockStart(e.target.value)} /></div>
            <div className="field"><label>Конец</label><input type="datetime-local" value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)} /></div>
            <button className="btn btn-primary" type="button" disabled={createBlock.isPending || !blockStart || !blockEnd} onClick={() => createBlock.mutate()}>
              {createBlock.isPending ? 'Сохраняем…' : 'Добавить в календарь'}
            </button>
            {error && <div className="state-box error">{error}</div>}
          </div>
        </div>
      )}

      {selected && (
        <div className="more-drawer calendar-detail-drawer" role="dialog" aria-modal="true" onClick={() => setSelected(null)}>
          <div className="more-panel stack" onClick={(e) => e.stopPropagation()}>
            <div className="row between"><p className="eyebrow">{selected.category}</p><button className="btn btn-secondary btn-compact" type="button" onClick={() => setSelected(null)}>Закрыть</button></div>
            {selected.kind === 'appointment' ? (
              <>
                <h2>{selected.title}</h2>
                <div className="calendar-detail-time">{selected.start?.toLocaleString('ru-RU')} — {selected.end?.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
                {selected.status && <span className="badge">{selected.status}</span>}
                {selected.master && <p><strong>Мастер:</strong> {selected.master}</p>}
                {selected.location && <p><strong>Место:</strong> {selected.location}</p>}
                {user?.id === selected.masterUserId && selected.serviceId && selected.organizationId && (
                  <CalendarAvailability
                    token={accessToken}
                    organizationId={selected.organizationId}
                    serviceId={selected.serviceId}
                    appointmentId={selected.id.startsWith('appt:') ? selected.id.slice(5) : selected.id}
                  />
                )}
                <button className="btn btn-primary" type="button" onClick={() => navigate(`/appointments/${selected.id.slice(5)}`)}>Открыть запись</button>
              </>
            ) : (
              <>
                <h2>Событие планера</h2>
                <div className="field"><label>Название</label><input value={blockTitle} onChange={(e) => setBlockTitle(e.target.value)} /></div>
                <div className="field"><label>Категория</label><select value={blockCat} onChange={(e) => setBlockCat(e.target.value)}>{palette.filter((c) => !c.system).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
                <div className="field"><label>Цвет</label><input type="color" value={blockColor || category(blockCat).color} onChange={(e) => setBlockColor(e.target.value)} /></div>
                <div className="field"><label>Начало</label><input type="datetime-local" value={blockStart} onChange={(e) => setBlockStart(e.target.value)} /></div>
                <div className="field"><label>Конец</label><input type="datetime-local" value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)} /></div>
                <button className="btn btn-primary" type="button" disabled={saveBlock.isPending || !blockStart || !blockEnd} onClick={() => saveBlock.mutate()}>
                  {saveBlock.isPending ? 'Сохраняем…' : 'Сохранить изменения'}
                </button>
                <button className="btn btn-danger" type="button" disabled={removeBlock.isPending} onClick={() => removeBlock.mutate(selected.id.slice(6))}>Удалить событие</button>
              </>
            )}
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

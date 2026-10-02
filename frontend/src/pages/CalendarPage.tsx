import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import luxonPlugin from '@fullcalendar/luxon3'
import ruLocale from '@fullcalendar/core/locales/ru'
import type { DateSelectArg, DatesSetArg, EventClickArg, EventContentArg, EventDropArg, EventInput } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { appointmentStatusLabel, statusBadgeClass } from '@/shared/lib/status'
import { datetimeLocalToIso, formatRangeInTimezone, isoToDatetimeLocal, wallTimeInTimezoneToUtcIso } from '@/shared/lib/time'
import { formatMoney } from '@/shared/lib/money'
import { formatUserError } from '@/shared/lib/app-error'
import { moderationError } from '@/shared/lib/moderation'
import { usePreference } from '@/shared/lib/preferences'
import { Hint } from '@/shared/ui/Hint'
import { Drawer } from '@/shared/ui/Drawer'
import { Modal } from '@/shared/ui/Modal'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { EmptyState } from '@/shared/ui/EmptyState'
import { toast } from '@/shared/ui/Toast'
import {
  appointmentToneClass,
  calendarColorClass,
  calendarColorCss,
  CALENDAR_COLOR_TOKENS,
  CALENDAR_COLOR_LABELS,
  canDragAppointment,
  countEventsOutsideRange,
  DEFAULT_DISPLAY_RANGE,
  detectHorizontalSwipe,
  swipeStep,
  displayRangeToSlotTimes,
  extendDisplayRangeForEvents,
  isCalendarViewId,
  isTerminalStatus,
  minutesFromMidnight,
  minutesToTime,
  normalizeCalendarColor,
  parseHHMM,
  prefersReducedMotion,
  rangeToDayInterval,
  staffRoleLabel,
  type CalendarViewId,
  type DisplayRange,
  validateDisplayRange,
  weekdayIndex,
  zonedYmd,
} from '@/pages/calendar-helpers'
import { CalendarAvailability } from '@/pages/CalendarAvailability'
import { CalendarMobile } from '@/pages/CalendarMobile'
import { RescheduleDialog } from '@/pages/RescheduleDialog'
import '@/pages/calendar.css'

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
  location_timezone?: string
  booking_mode?: string
  visit_group_id?: string | null
  duration_minutes?: number
  price_minor?: number
  currency?: string
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
  statusRaw?: string
  start: Date | null
  end: Date | null
  location?: string
  master?: string
  clientName?: string
  color?: string
  serviceId?: string
  organizationId?: string
  masterUserId?: string
  visitGroupId?: string
  visitLabel?: string
  durationMinutes?: number
  priceMinor?: number
  currency?: string
  bookingMode?: string
  timezone?: string
  readonly?: boolean
}

const MASTER_CATEGORIES: Category[] = [
  { id: 'client', label: 'Клиент', color: 'primary', icon: '✦', system: true },
  { id: 'personal', label: 'Личное', color: 'neutral', icon: '●' },
  { id: 'break', label: 'Перерыв', color: 'info', icon: 'Ⅱ' },
  { id: 'blocked', label: 'Заблокировано', color: 'danger', icon: '◆' },
  { id: 'task', label: 'Задача', color: 'success', icon: '✓' },
  { id: 'delivery', label: 'Получение / доставка', color: 'teal', icon: '→' },
]

const REP_CATEGORIES: Category[] = [
  { id: 'delivery', label: 'Доставка', color: 'primary', icon: '→' },
  { id: 'salon_visit', label: 'Посещение салона', color: 'success', icon: '⌂' },
  { id: 'task', label: 'Задача', color: 'violet', icon: '✓' },
  { id: 'personal', label: 'Личное', color: 'neutral', icon: '●' },
]

const ADMIN_CATEGORIES: Category[] = [
  { id: 'client', label: 'Запись клиента', color: 'primary', icon: '✦', system: true },
  { id: 'task', label: 'Задача', color: 'success', icon: '✓' },
  { id: 'operational', label: 'Операционное', color: 'warning', icon: '◆' },
  { id: 'staff', label: 'Сотрудники', color: 'violet', icon: '◎' },
]

function categoriesFor(kind: string): Category[] {
  if (kind === 'supplier_rep') return REP_CATEGORIES
  if (kind === 'salon_admin' || kind === 'salon_owner' || kind === 'chain_owner') return ADMIN_CATEGORIES
  return MASTER_CATEGORIES
}

function eventCard(info: EventContentArg) {
  const status = String(info.event.extendedProps.statusLabel ?? '')
  const client = String(info.event.extendedProps.clientName ?? '')
  const visit = String(info.event.extendedProps.visitLabel ?? '')
  const secondary = String(info.event.extendedProps.secondary ?? '')
  return (
    <div className="calendar-event-card">
      <div className="calendar-event-time">{info.timeText}</div>
      <strong>{info.event.title}</strong>
      {client ? <span className="calendar-event-client">{client}</span> : null}
      <div className="calendar-event-meta">
        {status ? <span>{status}</span> : null}
        {secondary ? <span>{secondary}</span> : null}
      </div>
      {visit ? <span className="calendar-event-visit">{visit}</span> : null}
    </div>
  )
}

function useCompactCalendar() {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 599px)').matches : true,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 599px)')
    const onChange = () => setCompact(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    window.addEventListener('resize', onChange)
    return () => {
      mq.removeEventListener('change', onChange)
      window.removeEventListener('resize', onChange)
    }
  }, [])
  return compact
}

function initialRange() {
  const start = new Date()
  start.setDate(start.getDate() - 7)
  const end = new Date()
  end.setDate(end.getDate() + 45)
  return { from: start.toISOString(), to: end.toISOString() }
}

type SheetAction = 'empty' | 'event' | null

export function CalendarPage({ embedded = false, overlayRepId }: { embedded?: boolean; overlayRepId?: string }) {
  const { accessToken, user } = useAuth()
  const cabinet = useCabinet()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const calendarRef = useRef<FullCalendar | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const scrollPreserve = useRef<number | null>(null)
  const swipeStart = useRef<{ x: number; y: number; id: number; t: number; blocked: boolean } | null>(null)
  const interacting = useRef(false)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const compact = useCompactCalendar()
  const wasCompact = useRef(compact)
  const isRepPlanner = cabinet.kind === 'supplier_rep' || Boolean(overlayRepId)
  const readOnlyOverlay = Boolean(overlayRepId)
  const basePalette = isRepPlanner ? REP_CATEGORIES : categoriesFor(cabinet.kind)
  const ownerMode = ['salon_owner', 'chain_owner', 'salon_admin'].includes(cabinet.kind)
  const orgID = cabinet.selectedOrg?.organization.id
  const salonBranches = cabinet.selectedOrg?.branches ?? []

  const viewPrefKey = embedded
    ? 'calendar.view.embedded'
    : compact
      ? 'calendar.view.mobile'
      : 'calendar.view.desktop'
  const defaultView: CalendarViewId = compact ? 'timeGridDay' : 'timeGridWeek'
  const [savedView, setSavedView] = usePreference<string>(viewPrefKey, defaultView)
  const [displayRangePref, setDisplayRangePref] = usePreference<DisplayRange>('calendar.displayRange', DEFAULT_DISPLAY_RANGE)
  const [rangeDraft, setRangeDraft] = useState<DisplayRange>(displayRangePref)
  const [rangeError, setRangeError] = useState<string | null>(null)

  const [range, setRange] = useState(initialRange)
  const [currentView, setCurrentView] = useState<CalendarViewId>(() => {
    if (!isCalendarViewId(savedView)) return defaultView
    // Phone week maps to 3-day strip.
    if (compact && savedView === 'timeGridWeek') return 'timeGridThreeDay'
    if (!compact && savedView === 'timeGridThreeDay') return 'timeGridWeek'
    return savedView
  })
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [hidden, setHidden] = useState<string[]>([])
  const [error, setError] = useState<unknown>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selected, setSelected] = useState<CalendarSelection | null>(null)
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [pendingApptDrop, setPendingApptDrop] = useState<{ id: string; start: Date; end: Date; revert: () => void } | null>(null)
  const [pendingInterval, setPendingInterval] = useState<{ start: Date; end: Date } | null>(null)
  const [moving, setMoving] = useState(false)
  const [masterFilter, setMasterFilter] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [blockTitle, setBlockTitle] = useState('Личное время')
  const [blockCat, setBlockCat] = useState(basePalette.find((c) => !c.system)?.id ?? 'personal')
  const [blockStart, setBlockStart] = useState('')
  const [blockEnd, setBlockEnd] = useState('')
  const [blockColor, setBlockColor] = useState('success')
  const [sheet, setSheet] = useState<SheetAction>(null)
  const [sheetSlot, setSheetSlot] = useState<Date | null>(null)
  const [swipeFlash, setSwipeFlash] = useState(false)
  const [intervalMode, setIntervalMode] = useState(false)
  const [intervalStartMin, setIntervalStartMin] = useState<number | null>(null)
  const [intervalEndMin, setIntervalEndMin] = useState<number | null>(null)
  const scrolledOnce = useRef(false)

  const selectedBranch = salonBranches.find((b) => b.id === branchFilter) ?? salonBranches[0]
  const salonTimezone = selectedBranch?.timezone || 'Europe/Moscow'

  const effectiveRange = useMemo(() => {
    const validated = validateDisplayRange(displayRangePref.from, displayRangePref.to)
    return validated.ok ? validated.value : DEFAULT_DISPLAY_RANGE
  }, [displayRangePref])

  useEffect(() => {
    setRangeDraft(displayRangePref)
  }, [displayRangePref])

  useEffect(() => {
    if (wasCompact.current === compact) return
    wasCompact.current = compact
    setCurrentView((prev) => {
      const next: CalendarViewId = compact
        ? (prev === 'timeGridWeek' || prev === 'timeGridThreeDay' ? 'timeGridThreeDay' : 'timeGridDay')
        : (prev === 'timeGridThreeDay' ? 'timeGridWeek' : prev === 'timeGridDay' ? 'timeGridWeek' : prev)
      queueMicrotask(() => calendarRef.current?.getApi().changeView(next))
      return next
    })
  }, [compact])

  useEffect(() => {
    if (!isCalendarViewId(savedView)) return
    let mapped: CalendarViewId = savedView
    if (compact && mapped === 'timeGridWeek') mapped = 'timeGridThreeDay'
    if (!compact && mapped === 'timeGridThreeDay') mapped = 'timeGridWeek'
    if (mapped === currentView) return
    setCurrentView(mapped)
    if (!(compact && (mapped === 'timeGridDay' || mapped === 'dayGridMonth'))) {
      calendarRef.current?.getApi().changeView(mapped)
    }
    // hydrate from preference when it arrives / changes externally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedView])

  useEffect(() => {
    const el = toolbarRef.current
    if (!el) return
    const apply = () => {
      const h = Math.ceil(el.getBoundingClientRect().height)
      el.parentElement?.style.setProperty('--cal-toolbar-h', `${h}px`)
    }
    apply()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [embedded, compact, currentView, ownerMode, settingsOpen])

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
    () =>
      basePalette.map((c) => ({
        ...c,
        color: c.system ? c.color : normalizeCalendarColor(savedColors[c.id] || c.color, c.id),
      })),
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
    placeholderData: keepPreviousData,
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
    placeholderData: keepPreviousData,
  })

  const blocks = useQuery({
    queryKey: ['planner-blocks', range.from, range.to, ownerMode ? orgID : ''],
    queryFn: () => apiRequest<{ items: PlannerBlock[] }>(
      `/v1/planner/blocks?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}${ownerMode && orgID ? `&organization_id=${orgID}` : ''}`,
      { token: accessToken },
    ),
    enabled: Boolean(accessToken && (!ownerMode || orgID)),
    placeholderData: keepPreviousData,
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

  const clients = useQuery({
    queryKey: ['calendar-clients', orgID],
    queryFn: () =>
      apiRequest<{ items: Array<{ user_id: string; display_name: string }> }>(
        `/v1/clients/mine${orgID ? `?organization_id=${orgID}` : ''}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken) && cabinet.kind !== 'supplier_rep',
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
    queryKey: ['calendar-exceptions', orgID, hoursMaster, range.from, range.to],
    queryFn: () => {
      const fromDay = range.from.slice(0, 10)
      const toDay = range.to.slice(0, 10)
      const qs = ownerMode && hoursMaster && hoursMaster !== user?.id
        ? `/v1/calendar/schedule-exceptions?organization_id=${orgID}&master_user_id=${hoursMaster}&from=${fromDay}&to=${toDay}`
        : `/v1/me/schedule-exceptions?from=${fromDay}&to=${toDay}`
      return apiRequest<{ items: ExceptionItem[] }>(qs, { token: accessToken })
    },
    enabled: Boolean(accessToken),
    placeholderData: keepPreviousData,
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
    return palette.find((c) => c.id === id) ?? { id, label: id, color: 'neutral', icon: '•' }
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

  const visitNames = useMemo(() => {
    const map = new Map<string, Array<{ name: string; start: string }>>()
    for (const a of appointments.data?.items ?? []) {
      const gid = a.visit_group_id?.trim()
      if (!gid) continue
      const list = map.get(gid) ?? []
      list.push({ name: a.service_name, start: a.starts_at })
      map.set(gid, list)
    }
    const labels = new Map<string, string[]>()
    for (const [gid, list] of map) {
      labels.set(
        gid,
        [...list].sort((a, b) => a.start.localeCompare(b.start)).map((x) => x.name),
      )
    }
    return labels
  }, [appointments.data])

  const clientNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const c of clients.data?.items ?? []) {
      if (c.user_id) map[c.user_id] = c.display_name
    }
    return map
  }, [clients.data])

  const events: EventInput[] = useMemo(() => {
    const out: EventInput[] = []
    for (const a of appointments.data?.items ?? []) {
      if (hidden.includes('client') || (masterFilter && a.master_user_id !== masterFilter) || (branchFilter && a.branch_id !== branchFilter)) continue
      const masterName = masters.data?.[a.master_user_id] ?? staffRoleLabel('master')
      const clientName = clientNames[a.client_user_id] || ''
      const terminal = isTerminalStatus(a.status)
      const own = !readOnlyOverlay && (a.master_user_id === user?.id || ownerMode)
      const canMove = own && canDragAppointment(a.status, a.booking_mode)
      const group = a.visit_group_id ? visitNames.get(a.visit_group_id) ?? [] : []
      const visitLabel = group.length > 1 ? group.join(' → ') : ''
      out.push({
        id: `appt:${a.id}`,
        title: a.service_name,
        start: a.starts_at,
        end: a.ends_at,
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        editable: canMove,
        startEditable: canMove,
        durationEditable: false,
        classNames: [appointmentToneClass(a.status), visitLabel ? 'is-visit' : '', !canMove ? 'is-readonly' : ''].filter(Boolean),
        extendedProps: {
          kind: 'appointment',
          category: 'client',
          categoryLabel: 'Клиент',
          status: a.status,
          statusLabel: appointmentStatusLabel(a.status),
          secondary: [masterName, a.location_name].filter(Boolean).join(' · '),
          location: [a.location_name, a.location_address].filter(Boolean).join(', '),
          master: masterName,
          clientName,
          serviceId: a.service_id,
          organizationId: a.organization_id,
          masterUserId: a.master_user_id,
          visitGroupId: a.visit_group_id,
          visitLabel,
          durationMinutes: a.duration_minutes,
          priceMinor: a.price_minor,
          currency: a.currency,
          bookingMode: a.booking_mode,
          timezone: a.location_timezone,
          terminal,
          readonly: !canMove,
        },
      })
    }
    for (const b of blocks.data?.items ?? []) {
      const cat = category(b.category || 'personal')
      if (hidden.includes(cat.id)) continue
      if (masterFilter && b.owner_user_id && b.owner_user_id !== masterFilter) continue
      const colorId = normalizeCalendarColor(b.color || cat.color, cat.id)
      const colorCss = calendarColorCss(colorId, cat.id)
      const colorClass = calendarColorClass(colorId, cat.id)
      const own = !readOnlyOverlay && (!b.owner_user_id || b.owner_user_id === user?.id || ownerMode)
      out.push({
        id: `block:${b.id}`,
        title: b.title,
        start: b.starts_at,
        end: b.ends_at,
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        editable: own,
        startEditable: own,
        durationEditable: own,
        classNames: ['is-planner-block', colorClass, own ? '' : 'is-readonly'].filter(Boolean),
        extendedProps: {
          kind: 'block',
          category: cat.id,
          categoryLabel: cat.label,
          icon: cat.icon,
          color: colorId,
          colorCss,
          readonly: !own,
        },
      })
    }
    for (const t of fieldTasks.data?.items ?? []) {
      if (!t.due_at) continue
      const catId = t.planner_category || (t.kind === 'salon_visit' || t.kind === 'commercial_visit' ? 'salon_visit' : t.kind === 'delivery_support' ? 'delivery' : 'task')
      const cat = category(catId)
      if (hidden.includes(cat.id)) continue
      const colorId = normalizeCalendarColor(cat.color, cat.id)
      const start = new Date(t.due_at)
      out.push({
        id: `task:${t.id}`,
        title: t.title,
        start: start.toISOString(),
        end: new Date(start.getTime() + 45 * 60 * 1000).toISOString(),
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        editable: false,
        classNames: ['is-planner-block', calendarColorClass(colorId, cat.id), 'is-readonly'],
        extendedProps: {
          kind: 'block',
          category: cat.id,
          categoryLabel: cat.label,
          icon: cat.icon,
          status: t.status,
          statusLabel: t.status,
          color: colorId,
          colorCss: calendarColorCss(colorId, cat.id),
          readonly: true,
        },
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
          backgroundColor: 'var(--color-danger-soft)',
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
        backgroundColor: 'var(--color-primary-muted)',
        borderColor: 'var(--color-primary)',
        editable: false,
        classNames: ['is-work-mode', 'is-readonly'],
        extendedProps: {
          kind: 'work-mode',
          category: w.mode,
          categoryLabel: w.mode_label,
          location: w.location_label,
          readonly: true,
        },
      })
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments.data, blocks.data, fieldTasks.data, exceptions.data, workModes.data, hidden, masterFilter, branchFilter, masters.data, palette, clientNames, visitNames, readOnlyOverlay, user?.id, ownerMode])

  const visibleEventMinutes = useMemo(() => {
    const fromMs = new Date(range.from).getTime()
    const toMs = new Date(range.to).getTime()
    return events
      .filter((e) => e.start && e.display !== 'background' && e.extendedProps?.kind !== 'work-mode')
      .filter((e) => {
        const t = new Date(String(e.start)).getTime()
        return t >= fromMs && t < toMs
      })
      .flatMap((e) => {
        const start = minutesFromMidnight(new Date(String(e.start)), salonTimezone)
        const end = e.end ? minutesFromMidnight(new Date(String(e.end)), salonTimezone) : start + 30
        return [start, end]
      })
  }, [events, range.from, range.to, salonTimezone])

  const appliedRange = useMemo(
    () => extendDisplayRangeForEvents(effectiveRange, visibleEventMinutes),
    [effectiveRange, visibleEventMinutes],
  )
  const { slotMinTime, slotMaxTime, fromMin, toMin } = displayRangeToSlotTimes(appliedRange)
  const baseFrom = parseHHMM(effectiveRange.from) ?? fromMin
  const baseTo = parseHHMM(effectiveRange.to) ?? toMin
  const outsideCounts = countEventsOutsideRange(
    visibleEventMinutes.filter((_, i) => i % 2 === 0),
    baseFrom,
    baseTo,
  )
  const rangeExtendedHint =
    appliedRange.from !== effectiveRange.from || appliedRange.to !== effectiveRange.to
      ? `Диапазон расширен: ${outsideCounts.earlier} раньше, ${outsideCounts.later} позже`
      : null

  const createBlock = useMutation({
    mutationFn: () => apiRequest('/v1/planner/blocks', {
      token: accessToken,
      body: {
        title: blockTitle.trim() || 'Событие',
        category: blockCat,
        starts_at: datetimeLocalToIso(blockStart, salonTimezone),
        ends_at: datetimeLocalToIso(blockEnd, salonTimezone),
        timezone: salonTimezone,
        color: normalizeCalendarColor(blockColor || category(blockCat).color, blockCat),
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
    onError: (e) => {
      setError(e)
      toast.error(formatUserError(e, 'Не удалось создать событие'))
    },
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
          color: normalizeCalendarColor(blockColor || category(blockCat).color, blockCat),
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
    onError: (e) => {
      setError(e)
      toast.error(formatUserError(e, 'Не удалось сохранить событие'))
    },
  })

  const removeBlock = useMutation({
    mutationFn: (id: string) => apiRequest(`/v1/planner/blocks/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      setSelected(null)
      setOk('Событие удалено')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['planner-blocks'] })
    },
    onError: (e) => {
      setError(e)
      toast.error(formatUserError(e, 'Не удалось удалить событие'))
    },
  })

  const saveWorkInterval = useMutation({
    mutationFn: async (payload: { start: Date; end: Date }) => {
      const interval = rangeToDayInterval(payload.start, payload.end, salonTimezone)
      if (!interval) throw new Error('Интервал должен укладываться в один день')
      const body = {
        items: [{
          day: interval.day,
          is_day_off: false,
          start_minute: interval.start_minute,
          end_minute: interval.end_minute,
          note: 'Рабочий интервал',
        }],
      }
      if (ownerMode && orgID && masterFilter && masterFilter !== user?.id) {
        return apiRequest(
          `/v1/calendar/schedule-exceptions?organization_id=${orgID}&master_user_id=${masterFilter}`,
          { method: 'PUT', token: accessToken, body },
        )
      }
      return apiRequest('/v1/me/schedule-exceptions', { method: 'PUT', token: accessToken, body })
    },
    onSuccess: async () => {
      setOk('Рабочий интервал сохранён')
      setIntervalMode(false)
      setIntervalStartMin(null)
      setIntervalEndMin(null)
      setPendingInterval(null)
      await qc.invalidateQueries({ queryKey: ['calendar-exceptions'] })
    },
    onError: (e) => {
      setError(e)
      toast.error(formatUserError(e, 'Не удалось сохранить интервал'))
    },
  })

  function resetIntervalSelection() {
    setIntervalMode(false)
    setIntervalStartMin(null)
    setIntervalEndMin(null)
    setPendingInterval(null)
  }

  function onMobileIntervalSlot(slotMin: number) {
    if (intervalStartMin == null) {
      setIntervalStartMin(slotMin)
      setIntervalEndMin(null)
      return
    }
    if (intervalEndMin == null) {
      setIntervalEndMin(slotMin)
      return
    }
    setIntervalStartMin(slotMin)
    setIntervalEndMin(null)
  }

  function confirmMobileInterval() {
    if (intervalStartMin == null || intervalEndMin == null) return
    const startMin = Math.min(intervalStartMin, intervalEndMin)
    const endMin = Math.max(intervalStartMin, intervalEndMin) + 30
    const ymd = zonedYmd(selectedDate, salonTimezone)
    const [y, mo, d] = ymd.split('-').map(Number)
    try {
      const startIso = wallTimeInTimezoneToUtcIso(y, mo, d, Math.floor(startMin / 60), startMin % 60, 0, salonTimezone)
      const endIso = endMin >= 1440
        ? wallTimeInTimezoneToUtcIso(y, mo, d + 1, 0, 0, 0, salonTimezone)
        : wallTimeInTimezoneToUtcIso(y, mo, d, Math.floor(endMin / 60), endMin % 60, 0, salonTimezone)
      setPendingInterval({ start: new Date(startIso), end: new Date(endIso) })
    } catch (e) {
      toast.error(formatUserError(e, 'Не удалось собрать интервал'))
    }
  }

  function captureScroll() {
    const scroller = wrapRef.current?.querySelector('.fc-scroller-liquid-absolute, .fc-scroller') as HTMLElement | null
    if (scroller) scrollPreserve.current = scroller.scrollTop
  }

  function restoreScroll() {
    const top = scrollPreserve.current
    if (top == null) return
    requestAnimationFrame(() => {
      const scroller = wrapRef.current?.querySelector('.fc-scroller-liquid-absolute, .fc-scroller') as HTMLElement | null
      if (scroller) scroller.scrollTop = top
    })
  }

  async function persistMove(id: string, start: Date | null, end: Date | null, resized: boolean) {
    if (!start || !end) return false
    setMoving(true)
    captureScroll()
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
        await qc.invalidateQueries({ queryKey: ['appointments'] })
        setOk('Запись перенесена')
      }
      setError(null)
      restoreScroll()
      return true
    } catch (e) {
      setError(e)
      toast.error(formatUserError(e, 'Не удалось перенести событие'))
      return false
    } finally {
      setMoving(false)
    }
  }

  async function onDrop(info: EventDropArg) {
    if (readOnlyOverlay || info.event.extendedProps.readonly) {
      info.revert()
      return
    }
    if (info.event.id.startsWith('appt:')) {
      if (!canDragAppointment(String(info.event.extendedProps.status ?? ''), String(info.event.extendedProps.bookingMode ?? ''))) {
        info.revert()
        toast.error('Эту запись нельзя перенести перетаскиванием')
        return
      }
      if (!info.event.start || !info.event.end) {
        info.revert()
        return
      }
      setPendingApptDrop({
        id: info.event.id,
        start: info.event.start,
        end: info.event.end,
        revert: () => info.revert(),
      })
      return
    }
    if (!await persistMove(info.event.id, info.event.start, info.event.end, false)) info.revert()
  }

  async function onResize(info: EventResizeDoneArg) {
    if (readOnlyOverlay || info.event.extendedProps.readonly) {
      info.revert()
      return
    }
    if (info.event.id.startsWith('appt:')) {
      info.revert()
      toast.error('Длительность записи определяется выбранной услугой')
      return
    }
    if (!await persistMove(info.event.id, info.event.start, info.event.end, true)) info.revert()
  }

  function openEventById(id: string) {
    const ev = events.find((e) => e.id === id)
    if (!ev) return
    const p = ev.extendedProps ?? {}
    if (p.kind === 'work-mode') return
    const start = ev.start ? new Date(String(ev.start)) : null
    const end = ev.end ? new Date(String(ev.end)) : null
    const sel: CalendarSelection = {
      id,
      kind: p.kind === 'appointment' ? 'appointment' : 'block',
      title: String(ev.title ?? ''),
      category: String(p.categoryLabel ?? ''),
      categoryId: p.category,
      status: p.statusLabel,
      statusRaw: p.status,
      start,
      end,
      location: p.location,
      master: p.master,
      clientName: p.clientName,
      color: p.color,
      serviceId: p.serviceId,
      organizationId: p.organizationId,
      masterUserId: p.masterUserId,
      visitGroupId: p.visitGroupId,
      visitLabel: p.visitLabel,
      durationMinutes: p.durationMinutes,
      priceMinor: p.priceMinor,
      currency: p.currency,
      bookingMode: p.bookingMode,
      timezone: p.timezone,
      readonly: Boolean(p.readonly),
    }
    setSelected(sel)
    if (sel.kind === 'block') {
      setBlockTitle(sel.title)
      setBlockCat(sel.categoryId || 'personal')
      setBlockColor(normalizeCalendarColor(sel.color || category(sel.categoryId || 'personal').color, sel.categoryId || 'personal'))
      setBlockStart(sel.start ? isoToDatetimeLocal(sel.start.toISOString(), salonTimezone) : '')
      setBlockEnd(sel.end ? isoToDatetimeLocal(sel.end.toISOString(), salonTimezone) : '')
    }
  }

  function onEventClick(info: EventClickArg) {
    if (info.event.display === 'background') return
    openEventById(info.event.id)
  }

  function onDatesSet(info: DatesSetArg) {
    const viewType = info.view.type
    if (isCalendarViewId(viewType) && viewType !== currentView) {
      setCurrentView(viewType)
      setSavedView(viewType)
    }
    setSelectedDate(info.view.currentStart)
    const next = { from: info.start.toISOString(), to: info.end.toISOString() }
    setRange((current) => current.from === next.from && current.to === next.to ? current : next)
    restoreScroll()
  }

  function onSelectSlot(info: DateSelectArg) {
    if (readOnlyOverlay) {
      info.view.calendar.unselect()
      return
    }
    const start = info.start
    const end = info.end ?? new Date(info.start.getTime() + 60 * 60 * 1000)
    if (intervalMode) {
      setPendingInterval({ start, end })
      info.view.calendar.unselect()
      return
    }
    if (compact) {
      setSheetSlot(start)
      setBlockStart(isoToDatetimeLocal(start.toISOString(), salonTimezone))
      setBlockEnd(isoToDatetimeLocal(end.toISOString(), salonTimezone))
      setSheet('empty')
      info.view.calendar.unselect()
      return
    }
    setBlockStart(isoToDatetimeLocal(start.toISOString(), salonTimezone))
    setBlockEnd(isoToDatetimeLocal(end.toISOString(), salonTimezone))
    setBlockColor(normalizeCalendarColor(category(blockCat).color, blockCat))
    setEditorOpen(true)
    info.view.calendar.unselect()
  }

  function changeView(id: CalendarViewId) {
    const mapped: CalendarViewId =
      compact && id === 'timeGridWeek' ? 'timeGridThreeDay'
        : !compact && id === 'timeGridThreeDay' ? 'timeGridWeek'
          : id
    setCurrentView(mapped)
    setSavedView(mapped)
    if (!(compact && (mapped === 'timeGridDay' || mapped === 'dayGridMonth'))) {
      calendarRef.current?.getApi().changeView(mapped)
    }
  }

  function goToDate(date: Date) {
    setSelectedDate(date)
    calendarRef.current?.getApi().gotoDate(date)
  }

  function flashSwipe() {
    if (prefersReducedMotion()) return
    setSwipeFlash(true)
    window.setTimeout(() => setSwipeFlash(false), 180)
  }

  function shiftPeriod(delta: number) {
    const api = calendarRef.current?.getApi()
    if (api) {
      if (delta > 0) api.next()
      else api.prev()
      setSelectedDate(api.getDate())
    } else {
      const next = new Date(selectedDate)
      if (currentView === 'dayGridMonth') next.setMonth(next.getMonth() + delta)
      else if (currentView === 'timeGridWeek' || currentView === 'timeGridThreeDay' || currentView === 'listWeek') next.setDate(next.getDate() + delta * (currentView === 'timeGridThreeDay' ? 3 : 7))
      else next.setDate(next.getDate() + delta)
      goToDate(next)
    }
    flashSwipe()
  }

  function shiftDay(delta: number) {
    const next = new Date(selectedDate)
    next.setDate(next.getDate() + delta)
    goToDate(next)
    flashSwipe()
  }

  function openCreateAt(date: Date) {
    if (readOnlyOverlay) return
    const ymd = zonedYmd(date, salonTimezone)
    const [year, month, day] = ymd.split('-').map(Number)
    const hoursToday = (hours.data?.items ?? []).find((h) => h.weekday === weekdayIndex(date, salonTimezone))
    const workStart = hoursToday ? hoursToday.start_minute : 10 * 60
    const workEnd = hoursToday ? hoursToday.end_minute : 19 * 60
    const clockMin = date.getHours() * 60 + date.getMinutes()
    const startMin = clockMin >= workStart && clockMin <= workEnd - 30 ? clockMin : workStart
    const startH = Math.floor(startMin / 60)
    const startM = startMin % 60
    try {
      const startIso = wallTimeInTimezoneToUtcIso(year, month, day, startH, startM, 0, salonTimezone)
      const endIso = new Date(new Date(startIso).getTime() + 60 * 60 * 1000).toISOString()
      setBlockStart(isoToDatetimeLocal(startIso, salonTimezone))
      setBlockEnd(isoToDatetimeLocal(endIso, salonTimezone))
    } catch {
      setBlockStart(`${ymd}T10:00`)
      setBlockEnd(`${ymd}T11:00`)
    }
    setBlockColor(normalizeCalendarColor(category(blockCat).color, blockCat))
    setEditorOpen(true)
  }

  function submitCreate() {
    if (!blockStart || !blockEnd) return
    if (blockEnd <= blockStart) {
      setError('Конец события должен быть позже начала')
      return
    }
    const banned = moderationError(blockTitle)
    if (banned) {
      setError(banned)
      return
    }
    setError(null)
    createBlock.mutate()
  }

  function saveDisplayRange() {
    const result = validateDisplayRange(rangeDraft.from, rangeDraft.to)
    if (!result.ok) {
      setRangeError(result.error)
      return
    }
    setRangeError(null)
    setDisplayRangePref(result.value)
    setOk('Диапазон отображения сохранён')
  }

  function onPointerDownSwipe(e: ReactPointerEvent) {
    if (e.pointerType === 'mouse') return
    const target = e.target as HTMLElement | null
    if (
      target?.closest('.fc-event') ||
      target?.closest('button') ||
      target?.closest('a') ||
      target?.closest('input') ||
      target?.closest('select') ||
      target?.closest('textarea')
    ) {
      swipeStart.current = null
      return
    }
    if (interacting.current) {
      swipeStart.current = null
      return
    }
    swipeStart.current = { x: e.clientX, y: e.clientY, id: e.pointerId, t: Date.now(), blocked: false }
  }

  function onPointerUpSwipe(e: ReactPointerEvent) {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start || start.id !== e.pointerId || start.blocked) return
    if (Date.now() - start.t > 600) return
    const dir = detectHorizontalSwipe(e.clientX - start.x, e.clientY - start.y)
    if (!dir) return
    if (swipeStep(currentView, compact) === 'day') {
      shiftDay(dir === 'left' ? 1 : -1)
    } else {
      shiftPeriod(dir === 'left' ? 1 : -1)
    }
  }

  const loading = appointments.isLoading || blocks.isLoading || hours.isLoading
  const showMobileDay = compact && (currentView === 'timeGridDay' || currentView === 'dayGridMonth')
  const apptId = selected?.kind === 'appointment' && selected.id.startsWith('appt:') ? selected.id.slice(5) : ''

  useEffect(() => {
    if (showMobileDay) return
    const api = calendarRef.current?.getApi()
    if (!api) return
    api.setOption('slotMinTime', slotMinTime)
    api.setOption('slotMaxTime', slotMaxTime)
  }, [showMobileDay, slotMinTime, slotMaxTime])

  useEffect(() => {
    if (showMobileDay) return
    const id = requestAnimationFrame(() => calendarRef.current?.getApi().updateSize())
    return () => cancelAnimationFrame(id)
  }, [showMobileDay, currentView, loading])

  useEffect(() => {
    const topbar = document.querySelector('.topbar') as HTMLElement | null
    const apply = () => {
      const h = topbar ? Math.ceil(topbar.getBoundingClientRect().height) : 0
      document.documentElement.style.setProperty('--cal-app-top', `${h}px`)
    }
    apply()
    const ro = topbar && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null
    if (topbar) ro?.observe(topbar)
    return () => {
      ro?.disconnect()
      document.documentElement.style.removeProperty('--cal-app-top')
    }
  }, [])

  useEffect(() => {
    if (scrolledOnce.current || loading || showMobileDay) return
    scrolledOnce.current = true
    requestAnimationFrame(() => {
      const wrap = wrapRef.current
      if (!wrap) return
      const now = new Date()
      const hh = String(Math.max(0, Math.floor((minutesFromMidnight(now, salonTimezone) - 30) / 60))).padStart(2, '0')
      const mm = String(Math.floor(((minutesFromMidnight(now, salonTimezone) - 30) % 60 + 60) % 60 / 15) * 15).padStart(2, '0')
      const slot =
        wrap.querySelector(`.fc-timegrid-slot-lane[data-time^="${hh}:${mm}"]`) ||
        wrap.querySelector('.fc-timegrid-now-indicator-line') ||
        wrap.querySelector('.fc-event')
      slot?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    })
  }, [loading, showMobileDay, salonTimezone])

  const colorTokenPicker = (value: string, onPick: (token: string) => void) => (
    <div className="calendar-color-token-grid" role="listbox" aria-label="Цвет">
      {CALENDAR_COLOR_TOKENS.map((token) => (
        <button
          key={token}
          type="button"
          role="option"
          aria-selected={value === token}
          aria-label={CALENDAR_COLOR_LABELS[token]}
          className={`calendar-color-swatch cal-color-${token} ${value === token ? 'is-selected' : ''}`}
          onClick={() => onPick(token)}
        />
      ))}
    </div>
  )

  const editorForm = (
    <>
      <div className="field"><label htmlFor="cal-block-title">Название</label><input id="cal-block-title" value={blockTitle} onChange={(e) => setBlockTitle(e.target.value)} autoFocus aria-required="true" /></div>
      <div className="field"><label htmlFor="cal-block-cat">Категория</label><select id="cal-block-cat" value={blockCat} onChange={(e) => { setBlockCat(e.target.value); setBlockColor(normalizeCalendarColor(category(e.target.value).color, e.target.value)) }}>{palette.filter((c) => !c.system).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
      <div className="field"><span className="label">Цвет</span>{colorTokenPicker(blockColor, setBlockColor)}</div>
      <div className="field"><label htmlFor="cal-block-start">Начало</label><input id="cal-block-start" type="datetime-local" value={blockStart} onChange={(e) => setBlockStart(e.target.value)} aria-required="true" /></div>
      <div className="field"><label htmlFor="cal-block-end">Конец</label><input id="cal-block-end" type="datetime-local" value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)} aria-required="true" /></div>
      <button className="btn btn-primary" type="button" disabled={createBlock.isPending || !blockStart || !blockEnd} onClick={submitCreate}>
        {createBlock.isPending ? 'Сохраняем…' : 'Добавить в календарь'}
      </button>
      <ErrorBanner error={error} fallbackTitle="Не удалось создать событие" />
    </>
  )

  const detailBody = selected?.kind === 'appointment' ? (
    <div className="calendar-detail stack" data-testid="calendar-detail">
      {selected.status ? <span className={`badge ${statusBadgeClass(selected.statusRaw || '')}`}>{selected.status}</span> : null}
      <div className="calendar-detail-time">
        {selected.start && selected.end
          ? formatRangeInTimezone(selected.start.toISOString(), selected.end.toISOString(), selected.timezone || salonTimezone)
          : null}
      </div>
      <dl className="calendar-detail-list">
        {selected.clientName ? <><dt>Клиент</dt><dd>{selected.clientName}</dd></> : null}
        {selected.title ? <><dt>Услуга</dt><dd>{selected.title}</dd></> : null}
        {selected.master ? <><dt>Мастер</dt><dd>{selected.master}</dd></> : null}
        {selected.location ? <><dt>Место</dt><dd>{selected.location}</dd></> : null}
        {selected.durationMinutes ? <><dt>Длительность</dt><dd>{selected.durationMinutes} мин</dd></> : null}
        {typeof selected.priceMinor === 'number' ? <><dt>Цена</dt><dd>{formatMoney(selected.priceMinor, selected.currency)}</dd></> : null}
      </dl>
      {selected.visitLabel ? <p className="cal-visit-link">Один визит: {selected.visitLabel}</p> : null}
      {selected.readonly ? <p className="muted">Запись только для просмотра — перенос недоступен.</p> : null}
      <ErrorBanner error={error} fallbackTitle="Не удалось изменить запись" />
      {user?.id === selected.masterUserId && selected.serviceId && selected.organizationId && (
        <CalendarAvailability
          token={accessToken}
          organizationId={selected.organizationId}
          serviceId={selected.serviceId}
          appointmentId={apptId}
        />
      )}
      <div className="row gap wrap">
        {!selected.readonly && canDragAppointment(selected.statusRaw, selected.bookingMode) ? (
          <button className="btn btn-secondary" type="button" onClick={() => setRescheduleOpen(true)}>Перенести</button>
        ) : null}
        <button className="btn btn-primary" type="button" onClick={() => navigate(`/appointments/${apptId}`)}>Открыть запись</button>
      </div>
    </div>
  ) : selected ? (
    <div className="calendar-detail stack" data-testid="calendar-detail">
      {selected.readonly ? (
        <p className="muted">Событие только для просмотра.</p>
      ) : (
        <>
          <div className="field"><label htmlFor="cal-edit-title">Название</label><input id="cal-edit-title" value={blockTitle} onChange={(e) => setBlockTitle(e.target.value)} /></div>
          <div className="field"><label htmlFor="cal-edit-cat">Категория</label><select id="cal-edit-cat" value={blockCat} onChange={(e) => setBlockCat(e.target.value)}>{palette.filter((c) => !c.system).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
          <div className="field"><span className="label">Цвет</span>{colorTokenPicker(blockColor, setBlockColor)}</div>
          <div className="field"><label htmlFor="cal-edit-start">Начало</label><input id="cal-edit-start" type="datetime-local" value={blockStart} onChange={(e) => setBlockStart(e.target.value)} /></div>
          <div className="field"><label htmlFor="cal-edit-end">Конец</label><input id="cal-edit-end" type="datetime-local" value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)} /></div>
          <button className="btn btn-primary" type="button" disabled={saveBlock.isPending || !blockStart || !blockEnd} onClick={() => saveBlock.mutate()}>
            {saveBlock.isPending ? 'Сохраняем…' : 'Сохранить изменения'}
          </button>
          <button className="btn btn-danger" type="button" disabled={removeBlock.isPending} onClick={() => removeBlock.mutate(selected.id.slice(6))}>Удалить событие</button>
        </>
      )}
      <ErrorBanner error={error} fallbackTitle="Не удалось изменить событие" />
    </div>
  ) : null

  const body = (
    <div
      className={`stack calendar-shell calendar-page-root ${showMobileDay ? 'is-mobile-day' : ''} ${currentView === 'timeGridWeek' || currentView === 'timeGridThreeDay' ? 'is-fc-week' : ''} ${embedded ? 'is-embedded' : ''} ${swipeFlash ? 'is-swipe-transition' : ''}`}
      style={{ touchAction: 'pan-y' }}
      onPointerDown={onPointerDownSwipe}
      onPointerUp={onPointerUpSwipe}
      onPointerCancel={() => { swipeStart.current = null }}
    >
      {!embedded && (
        <div className="calendar-page-head calendar-toolbar-sticky">
          {!showMobileDay ? (
            <div className="stack-sm">
              <p className="eyebrow">Расписание</p>
              <h1>{ownerMode ? 'Календарь салона' : 'Мой календарь'}</h1>
              {!compact ? (
                <p className="muted">
                  Переносите события — при конфликте изменение отменится.
                  <Hint id="cal-dnd" title="Работа с расписанием">Личные события можно переносить и растягивать с начала и с конца. Записи клиента — только через подтверждение переноса. Завершённые и чужие события только для просмотра.</Hint>
                </p>
              ) : null}
            </div>
          ) : (
            <h1 className="visually-hidden">{ownerMode ? 'Календарь салона' : 'Мой календарь'}</h1>
          )}
          <div className="row">
            <Link className="btn btn-secondary btn-compact" to="/schedule" data-testid="calendar-open-schedule">Установка графика</Link>
            {!readOnlyOverlay ? (
              <button className="btn btn-primary btn-compact" type="button" onClick={() => (blockStart && blockEnd ? setEditorOpen(true) : openCreateAt(selectedDate))}>+ Событие</button>
            ) : null}
          </div>
        </div>
      )}

      {!editorOpen && !selected ? <ErrorBanner error={error} fallbackTitle="Не удалось изменить расписание" /> : null}
      {ok && <div className="state-box success">{ok}</div>}
      {moving ? <p className="muted" aria-live="polite">Сохраняем перенос…</p> : null}
      {intervalMode ? <p className="state-box">Выберите начало и конец интервала, затем сохраните</p> : null}

      {ownerMode && (
        <section className="calendar-resource-bar">
          <div className="field">
            <label htmlFor="cal-master-filter">Мастер</label>
            <select id="cal-master-filter" value={masterFilter} onChange={(e) => setMasterFilter(e.target.value)}>
              <option value="">Все мастера</option>
              {masterIDs.map((id) => <option key={id} value={id}>{masters.data?.[id] ?? 'Мастер'}</option>)}
            </select>
          </div>
          {(cabinet.kind === 'chain_owner' || salonBranches.length > 1) && (
            <div className="field">
              <label htmlFor="calendar-branch-switcher">Филиал</label>
              <select
                id="calendar-branch-switcher"
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

      <div className="calendar-controls calendar-toolbar-sticky" ref={toolbarRef}>
        <div className="calendar-view-tabs" aria-label="Режим календаря">
          {([
            ['timeGridDay', 'День'],
            [compact ? 'timeGridThreeDay' : 'timeGridWeek', compact ? '3 дня' : 'Неделя'],
            ['dayGridMonth', 'Месяц'],
            ['listWeek', 'Список'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`chip ${currentView === id || (id === 'timeGridThreeDay' && currentView === 'timeGridWeek') || (id === 'timeGridWeek' && currentView === 'timeGridThreeDay') ? 'active' : ''}`}
              aria-pressed={currentView === id}
              onClick={() => changeView(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="btn-link" type="button" onClick={() => setSettingsOpen((v) => !v)}>Настройки календаря</button>
      </div>

      {rangeExtendedHint ? (
        <p className="calendar-outside-hint muted" role="status">{rangeExtendedHint}</p>
      ) : null}

      <div className="calendar-category-row">
        {palette.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`calendar-category-chip ${hidden.includes(c.id) ? 'is-hidden' : ''}`}
            onClick={() => setHidden((h) => h.includes(c.id) ? h.filter((x) => x !== c.id) : [...h, c.id])}
          >
            <span style={{ backgroundColor: calendarColorCss(c.color, c.id) } as CSSProperties}>{c.icon}</span>{c.label}
          </button>
        ))}
      </div>

      {settingsOpen && (
        <section className="card calendar-color-settings stack" data-testid="calendar-settings">
          <div>
            <strong>Показывать с / до</strong>
            <p className="muted">Календарь откроется в этом диапазоне. События раньше или позже всё равно можно открыть — сетка чуть расширится.</p>
          </div>
          <div className="calendar-display-range">
            <div className="field">
              <label htmlFor="cal-range-from">С</label>
              <input id="cal-range-from" type="time" step={1800} value={rangeDraft.from} onChange={(e) => setRangeDraft((r) => ({ ...r, from: e.target.value }))} aria-required="true" />
            </div>
            <div className="field">
              <label htmlFor="cal-range-to">До</label>
              <input id="cal-range-to" type="time" step={1800} value={rangeDraft.to} onChange={(e) => setRangeDraft((r) => ({ ...r, to: e.target.value }))} aria-required="true" />
            </div>
          </div>
          {rangeError ? <p className="muted" role="alert">{rangeError}</p> : null}
          <button className="btn btn-secondary" type="button" onClick={saveDisplayRange}>Сохранить диапазон</button>

          <div><strong>Цвета и категории</strong><p className="muted">Системный цвет записи фиксирован. Остальные сохраняются для вашего профиля как токены палитры.</p></div>
          <div className="calendar-color-grid stack">
            {palette.map((c) => (
              <div key={c.id} className={c.system ? 'is-disabled' : ''}>
                <span>{c.label}</span>
                {c.system ? (
                  <span className="muted">системный</span>
                ) : (
                  colorTokenPicker(normalizeCalendarColor(c.color, c.id), (token) => colorSave.mutate({ category: c.id, color: token }))
                )}
              </div>
            ))}
          </div>

          <div className="row wrap gap">
            <Link className="btn btn-primary" to="/schedule" data-testid="settings-open-schedule">Установка графика</Link>
            <Link className="btn btn-secondary" to="/master">Рабочие часы пн–пт</Link>
          </div>
        </section>
      )}

      {showMobileDay ? (
        <CalendarMobile
          events={events}
          timezone={salonTimezone}
          selectedDate={selectedDate}
          hours={hours.data?.items ?? []}
          exceptions={exceptions.data?.items ?? []}
          displayRange={appliedRange}
          baseRange={effectiveRange}
          rangeExtendedHint={rangeExtendedHint}
          loading={loading}
          moving={moving}
          monthMode={currentView === 'dayGridMonth'}
          intervalSelecting={intervalMode}
          intervalStartMin={intervalStartMin}
          intervalEndMin={intervalEndMin}
          onSelectDate={(d) => {
            goToDate(d)
            if (currentView === 'dayGridMonth') changeView('timeGridDay')
          }}
          onToday={() => goToDate(new Date())}
          onPrev={() => (currentView === 'dayGridMonth' ? shiftPeriod(-1) : shiftDay(-1))}
          onNext={() => (currentView === 'dayGridMonth' ? shiftPeriod(1) : shiftDay(1))}
          onEventClick={(id) => {
            openEventById(id)
            setSheet(null)
          }}
          onEventLongPress={readOnlyOverlay ? undefined : (id) => {
            openEventById(id)
            setSheet('event')
            navigator.vibrate?.(10)
          }}
          onCreateSlot={readOnlyOverlay ? undefined : openCreateAt}
          onLongPressEmpty={readOnlyOverlay ? undefined : (d) => {
            setSheetSlot(d)
            setSheet('empty')
            navigator.vibrate?.(10)
          }}
          onIntervalSlotTap={onMobileIntervalSlot}
          onSaveInterval={confirmMobileInterval}
          onCancelInterval={resetIntervalSelection}
        />
      ) : null}

      {!showMobileDay && loading ? (
        <div className="calendar-wrap" aria-busy="true">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      ) : null}

      {!showMobileDay && !loading && hours.data?.items?.length === 0 && appointments.data?.items?.length === 0 ? (
        <EmptyState
          title="Рабочий график пока не задан"
          text="Календарь покажет рабочие часы после того, как мастер сохранит расписание."
          action={<Link className="btn btn-secondary" to="/schedule">Установка графика</Link>}
        />
      ) : null}

      {!showMobileDay ? (
      <div
        className="calendar-wrap"
        ref={wrapRef}
        style={{ ['--cal-slot-min-height' as string]: compact ? '44px' : '3.25em' } as CSSProperties}
      >
        <FullCalendar
          key={`${salonTimezone}-${orgID ?? 'self'}`}
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin]}
          initialView={currentView}
          views={{
            timeGridThreeDay: {
              type: 'timeGrid',
              duration: { days: 3 },
              buttonText: '3 дня',
            },
          }}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
          locale={ruLocale}
          timeZone={salonTimezone}
          height={embedded || compact ? 'auto' : '100%'}
          editable={!readOnlyOverlay}
          selectable={!readOnlyOverlay}
          selectMirror
          eventDurationEditable={!readOnlyOverlay}
          eventStartEditable={!readOnlyOverlay}
          eventResizableFromStart
          snapDuration="00:15:00"
          longPressDelay={350}
          eventLongPressDelay={350}
          slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          eventAllow={(_span, movingEvent) => {
            if (!movingEvent) return true
            if (movingEvent.extendedProps.readonly) return false
            if (String(movingEvent.id).startsWith('appt:')) {
              return canDragAppointment(
                String(movingEvent.extendedProps.status ?? ''),
                String(movingEvent.extendedProps.bookingMode ?? ''),
              )
            }
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
          eventDidMount={(arg) => {
            const css = String(arg.event.extendedProps.colorCss ?? '')
            if (css && arg.el.classList.contains('cal-color-hex')) {
              arg.el.style.setProperty('--cal-hex', css)
              arg.el.style.setProperty('--cal-event-accent', css)
            }
          }}
          eventDragStart={() => { interacting.current = true }}
          eventDragStop={() => { interacting.current = false }}
          eventResizeStart={() => { interacting.current = true }}
          eventResizeStop={() => { interacting.current = false }}
          selectAllow={() => {
            interacting.current = true
            return true
          }}
          unselect={() => { interacting.current = false }}
          eventDrop={onDrop}
          eventResize={onResize}
          eventClick={onEventClick}
          select={onSelectSlot}
          datesSet={onDatesSet}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          buttonText={{ today: 'Сегодня' }}
        />
      </div>
      ) : null}

      {compact ? (
        <Drawer open={editorOpen} onClose={() => setEditorOpen(false)} title={<div><p className="eyebrow">Календарь</p><h2>Новое событие</h2></div>}>
          {editorForm}
        </Drawer>
      ) : (
        <Modal open={editorOpen} onClose={() => setEditorOpen(false)} title="Новое событие">
          {editorForm}
        </Modal>
      )}

      {compact ? (
        <Drawer
          open={Boolean(selected) && sheet !== 'empty'}
          onClose={() => { setSelected(null); setRescheduleOpen(false); setSheet(null) }}
          label="Событие календаря"
          title={
            selected?.kind === 'appointment' ? (
              <div>
                <p className="eyebrow">Запись</p>
                <h2>{selected.title}</h2>
              </div>
            ) : selected ? (
              <div>
                <p className="eyebrow">{selected.category}</p>
                <h2>Событие планера</h2>
              </div>
            ) : undefined
          }
        >
          {sheet === 'event' && selected ? (
            <div className="stack cal-action-sheet">
              {selected.kind === 'appointment' ? (
                <>
                  <button type="button" className="btn btn-primary" onClick={() => { setSheet(null); navigate(`/appointments/${apptId}`) }}>Открыть</button>
                  {!selected.readonly && canDragAppointment(selected.statusRaw, selected.bookingMode) ? (
                    <button type="button" className="btn btn-secondary" onClick={() => { setSheet(null); setRescheduleOpen(true) }}>Перенести</button>
                  ) : null}
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-primary" onClick={() => setSheet(null)}>Изменить</button>
                  {!selected.readonly ? (
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={removeBlock.isPending}
                      onClick={() => { removeBlock.mutate(selected.id.slice(6)); setSheet(null) }}
                    >
                      Удалить
                    </button>
                  ) : null}
                </>
              )}
              <button type="button" className="btn btn-ghost" onClick={() => setSheet(null)}>Отмена</button>
            </div>
          ) : detailBody}
        </Drawer>
      ) : (
        <Modal
          open={Boolean(selected)}
          onClose={() => { setSelected(null); setRescheduleOpen(false) }}
          title={selected?.kind === 'block' ? 'Событие планера' : (selected?.title ?? 'Запись')}
          label="Событие календаря"
        >
          {detailBody}
        </Modal>
      )}

      <Drawer
        open={sheet === 'empty'}
        onClose={() => setSheet(null)}
        title={<div><p className="eyebrow">Календарь</p><h2>Действия</h2></div>}
        label="Действия календаря"
      >
        <div className="stack cal-action-sheet">
          <button type="button" className="btn btn-primary" onClick={() => { setSheet(null); if (sheetSlot) openCreateAt(sheetSlot) }}>Создать задачу</button>
          <Link className="btn btn-secondary" to="/clients" onClick={() => setSheet(null)}>Записать клиента</Link>
          <Link
            className="btn btn-secondary"
            to={sheetSlot ? `/schedule?start=${encodeURIComponent(sheetSlot.toISOString())}&end=${encodeURIComponent(new Date(sheetSlot.getTime() + 60 * 60 * 1000).toISOString())}` : '/schedule'}
            onClick={() => setSheet(null)}
          >
            Установить рабочие часы
          </Link>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setSheet(null)
              setIntervalMode(true)
              setIntervalStartMin(null)
              setIntervalEndMin(null)
              setOk('Выберите начало и конец интервала')
            }}
          >
            Выбрать интервал
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => { setSheet(null); setSettingsOpen(true) }}>Настройки календаря</button>
          <button type="button" className="btn btn-ghost" onClick={() => setSheet(null)}>Отмена</button>
        </div>
      </Drawer>

      {selected?.kind === 'appointment' && apptId ? (
        <RescheduleDialog
          open={rescheduleOpen}
          onClose={() => setRescheduleOpen(false)}
          token={accessToken}
          canOpenCalendar={false}
          appointment={{
            id: apptId,
            service_name: selected.title,
            starts_at: selected.start?.toISOString() ?? '',
            ends_at: selected.end?.toISOString() ?? '',
            status: selected.statusRaw ?? '',
            booking_mode: selected.bookingMode,
            location_timezone: selected.timezone || salonTimezone,
            location_name: selected.location,
            master_user_id: selected.masterUserId ?? '',
          }}
          onSuccess={async () => {
            await qc.invalidateQueries({ queryKey: ['calendar-appointments'] })
            setSelected(null)
            setRescheduleOpen(false)
          }}
        />
      ) : null}

      {pendingApptDrop ? (
        <Modal
          open
          onClose={() => {
            pendingApptDrop.revert()
            setPendingApptDrop(null)
          }}
          title="Перенести запись?"
        >
          <div className="stack">
            <p>
              Новое время: {formatRangeInTimezone(
                pendingApptDrop.start.toISOString(),
                pendingApptDrop.end.toISOString(),
                salonTimezone,
              )}. Подтвердите, если слот свободен.
            </p>
            <div className="row gap">
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  const okMove = await persistMove(pendingApptDrop.id, pendingApptDrop.start, pendingApptDrop.end, false)
                  if (!okMove) pendingApptDrop.revert()
                  setPendingApptDrop(null)
                }}
              >
                Подтвердить
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => { pendingApptDrop.revert(); setPendingApptDrop(null) }}>Отмена</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {pendingInterval ? (
        <Drawer
          open
          onClose={() => setPendingInterval(null)}
          title={<div><p className="eyebrow">График</p><h2>Сохранить рабочий интервал?</h2></div>}
          label="Подтверждение интервала"
        >
          <div className="stack cal-action-sheet">
            <p>
              {formatRangeInTimezone(
                pendingInterval.start.toISOString(),
                pendingInterval.end.toISOString(),
                salonTimezone,
              )}
            </p>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saveWorkInterval.isPending}
              onClick={() => saveWorkInterval.mutate(pendingInterval)}
            >
              Сохранить рабочий интервал
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setPendingInterval(null)}>Отмена</button>
          </div>
        </Drawer>
      ) : null}
    </div>
  )

  if (embedded) return body
  return <main className="page stack calendar-page-root">{body}</main>
}

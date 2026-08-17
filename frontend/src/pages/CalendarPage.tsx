import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import ruLocale from '@fullcalendar/core/locales/ru'
import type { EventClickArg, EventDropArg, EventInput } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useBuyerOrg } from '@/shared/lib/commerce'
import { useCabinet } from '@/shared/lib/cabinet'
import { datetimeLocalToIso } from '@/shared/lib/time'
import { Hint } from '@/shared/ui/Hint'

type Appointment = {
  id: string
  service_name: string
  status: string
  starts_at: string
  ends_at: string
}

type PlannerBlock = {
  id: string
  title: string
  starts_at: string
  ends_at: string
  category: string
  color?: string
}

const MASTER_CATEGORIES = [
  { id: 'client', label: 'Клиент', color: '#3d6b8a' },
  { id: 'personal', label: 'Личный блок', color: '#8a6d4d' },
  { id: 'task', label: 'Задача', color: '#4f7a5a' },
  { id: 'break', label: 'Перерыв', color: '#7a7a7a' },
  { id: 'delivery', label: 'Доставка / получение', color: '#6b5a8a' },
]

const REP_CATEGORIES = [
  { id: 'delivery', label: 'Delivery', color: '#3d6b8a' },
  { id: 'salon_visit', label: 'Salon visit', color: '#4f7a5a' },
  { id: 'task', label: 'Task', color: '#8a6d4d' },
  { id: 'personal', label: 'Personal', color: '#7a7a7a' },
]

const ADMIN_CATEGORIES = [
  { id: 'client', label: 'Appointment', color: '#3d6b8a' },
  { id: 'task', label: 'Staff task', color: '#4f7a5a' },
  { id: 'personal', label: 'Operational', color: '#8a6d4d' },
]

function categoriesFor(kind: string) {
  if (kind === 'supplier_rep') return REP_CATEGORIES
  if (kind === 'salon_admin' || kind === 'salon_owner' || kind === 'chain_owner') return ADMIN_CATEGORIES
  return MASTER_CATEGORIES
}

function colorFor(cat: string, palette: typeof MASTER_CATEGORIES) {
  return palette.find((c) => c.id === cat)?.color || '#3d6b8a'
}

export function CalendarPage({ embedded = false }: { embedded?: boolean }) {
  const { accessToken } = useAuth()
  const { buyerOrg } = useBuyerOrg()
  const cabinet = useCabinet()
  const navigate = useNavigate()
  const salonTimezone = buyerOrg?.branches[0]?.timezone || 'Europe/Moscow'
  const qc = useQueryClient()
  const palette = categoriesFor(cabinet.kind)
  const [hidden, setHidden] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [blockTitle, setBlockTitle] = useState('Личный блок')
  const [blockCat, setBlockCat] = useState(palette[1]?.id ?? 'personal')
  const [blockStart, setBlockStart] = useState('')
  const [blockEnd, setBlockEnd] = useState('')

  const from = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString()
  }, [])
  const to = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 45)
    return d.toISOString()
  }, [])

  const appts = useQuery({
    queryKey: ['appointments', 'master', 'calendar'],
    queryFn: () => apiRequest<{ items: Appointment[] }>('/v1/appointments/mine?role=master', { token: accessToken }),
    enabled: Boolean(accessToken) && cabinet.kind !== 'supplier_rep',
  })
  const blocks = useQuery({
    queryKey: ['planner-blocks', from, to],
    queryFn: () =>
      apiRequest<{ items: PlannerBlock[] }>(
        `/v1/planner/blocks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken),
  })

  const events: EventInput[] = useMemo(() => {
    const out: EventInput[] = []
    for (const a of appts.data?.items ?? []) {
      if (hidden.includes('client')) continue
      out.push({
        id: `appt:${a.id}`,
        title: a.service_name,
        start: a.starts_at,
        end: a.ends_at,
        backgroundColor: colorFor('client', palette),
        borderColor: colorFor('client', palette),
        extendedProps: { kind: 'appointment', status: a.status, category: 'client' },
      })
    }
    for (const b of blocks.data?.items ?? []) {
      const cat = b.category || 'personal'
      if (hidden.includes(cat)) continue
      out.push({
        id: `block:${b.id}`,
        title: b.title,
        start: b.starts_at,
        end: b.ends_at,
        backgroundColor: b.color || colorFor(cat, palette),
        borderColor: b.color || colorFor(cat, palette),
        extendedProps: { kind: 'block', category: cat },
      })
    }
    return out
  }, [appts.data, blocks.data, hidden, palette])

  const createBlock = useMutation({
    mutationFn: () =>
      apiRequest('/v1/planner/blocks', {
        token: accessToken,
        body: {
          title: blockTitle.trim() || 'Блок',
          category: blockCat,
          starts_at: datetimeLocalToIso(blockStart, salonTimezone),
          ends_at: datetimeLocalToIso(blockEnd, salonTimezone),
          timezone: salonTimezone,
          color: colorFor(blockCat, palette),
        },
      }),
    onSuccess: async () => {
      setOk('Блок добавлен')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['planner-blocks'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось создать блок'),
  })

  async function onDrop(info: EventDropArg) {
    const okMove = await persistMove(info.event.id, info.event.start, info.event.end, false)
    if (!okMove) info.revert()
  }
  async function onResize(info: EventResizeDoneArg) {
    const id = info.event.id
    if (id.startsWith('appt:')) {
      info.revert()
      setError('Длительность записи меняется только через услугу / перенос')
      return
    }
    const okMove = await persistMove(id, info.event.start, info.event.end, true)
    if (!okMove) info.revert()
  }

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
        setOk(resized ? 'Длительность обновлена' : 'Блок перенесён')
        setError(null)
        return true
      }
      if (id.startsWith('appt:')) {
        await apiRequest(`/v1/appointments/${id.slice(5)}/reschedule`, {
          token: accessToken,
          body: { starts_at: start.toISOString() },
        })
        await qc.invalidateQueries({ queryKey: ['appointments'] })
        setOk('Запись перенесена')
        setError(null)
        return true
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Конфликт времени — изменение отменено')
      return false
    }
    return false
  }

  function onEventClick(info: EventClickArg) {
    const id = info.event.id
    if (id.startsWith('appt:')) navigate(`/appointments/${id.slice(5)}`)
  }

  const body = (
    <div className="stack calendar-shell">
      {!embedded && (
        <div className="row between">
          <div className="stack-sm">
            <h1>Календарь</h1>
            <p className="muted">
              День / неделя / месяц / список. Перетаскивайте блоки.
              <Hint id="cal-dnd" title="Планировщик">
                Записи — блоки клиента. Личные блоки и перерывы можно растягивать. При конфликте изменение отменяется.
              </Hint>
            </p>
          </div>
          <Link className="btn btn-secondary btn-compact" to="/master">Рабочие часы</Link>
        </div>
      )}
      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}
      <div className="chip-row">
        {palette.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`chip ${hidden.includes(c.id) ? '' : 'active'}`}
            style={{ borderColor: c.color }}
            onClick={() => setHidden((h) => h.includes(c.id) ? h.filter((x) => x !== c.id) : [...h, c.id])}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="calendar-wrap">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'timeGridDay,timeGridWeek,dayGridMonth,listWeek',
          }}
          locale={ruLocale}
          height="auto"
          editable
          droppable={false}
          eventDurationEditable
          eventStartEditable
          slotMinTime="08:00:00"
          slotMaxTime="22:00:00"
          allDaySlot={false}
          nowIndicator
          events={events}
          eventDrop={onDrop}
          eventResize={onResize}
          eventClick={onEventClick}
          buttonText={{ today: 'Сегодня', month: 'Месяц', week: 'Неделя', day: 'День', list: 'Список' }}
        />
      </div>
      {!embedded && (
        <section className="card stack">
          <h2>Новый блок</h2>
          <div className="field">
            <label>Название</label>
            <input value={blockTitle} onChange={(e) => setBlockTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>Категория</label>
            <select value={blockCat} onChange={(e) => setBlockCat(e.target.value)}>
              {palette.filter((c) => c.id !== 'client').map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Начало</label>
              <input type="datetime-local" value={blockStart} onChange={(e) => setBlockStart(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Конец</label>
              <input type="datetime-local" value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)} />
            </div>
          </div>
          <button className="btn btn-primary" type="button" disabled={createBlock.isPending || !blockStart || !blockEnd} onClick={() => createBlock.mutate()}>
            Добавить блок
          </button>
        </section>
      )}
    </div>
  )

  if (embedded) return body
  return <main className="page stack">{body}</main>
}

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { statusBadgeClass, statusLabel } from '@/shared/lib/status'

type Appointment = {
  id: string
  service_name: string
  status: string
  starts_at: string
  ends_at: string
  price_minor: number
}

type ScheduleException = {
  id?: string
  day: string
  is_day_off: boolean
  start_minute?: number | null
  end_minute?: number | null
  note?: string
}

function dateKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(base: Date, days: number) {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

function toKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function minutesLabel(m: number) {
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

async function fetchExceptions(token: string | null): Promise<ScheduleException[]> {
  try {
    const res = await apiRequest<{ items: ScheduleException[] }>('/v1/me/schedule-exceptions', { token })
    return res.items ?? []
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 501)) return []
    throw e
  }
}

export function CalendarPage() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [selectedDay, setSelectedDay] = useState(() => toKey(new Date()))
  const [excMode, setExcMode] = useState<'off' | 'custom'>('off')
  const [startTime, setStartTime] = useState('10:00')
  const [endTime, setEndTime] = useState('19:00')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  function timeToMinutes(value: string) {
    const [h, m] = value.split(':').map(Number)
    return (h || 0) * 60 + (m || 0)
  }

  const weekDays = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return Array.from({ length: 14 }, (_, i) => addDays(start, i))
  }, [])

  const query = useQuery({
    queryKey: ['appointments', 'master', 'calendar'],
    queryFn: () =>
      apiRequest<{ items: Appointment[] }>('/v1/appointments/mine?role=master', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const exceptions = useQuery({
    queryKey: ['schedule-exceptions'],
    queryFn: () => fetchExceptions(accessToken),
    enabled: Boolean(accessToken),
  })

  const dayItems = useMemo(() => {
    return [...(query.data?.items ?? [])]
      .filter((a) => dateKey(a.starts_at) === selectedDay)
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
  }, [query.data, selectedDay])

  const selectedException = (exceptions.data ?? []).find((e) => e.day.slice(0, 10) === selectedDay)

  const saveException = useMutation({
    mutationFn: () =>
      apiRequest('/v1/me/schedule-exceptions', {
        method: 'PUT',
        token: accessToken,
        body: {
          day: selectedDay,
          is_day_off: excMode === 'off',
          start_minute: excMode === 'custom' ? timeToMinutes(startTime) : null,
          end_minute: excMode === 'custom' ? timeToMinutes(endTime) : null,
          note: note.trim(),
        },
      }),
    onSuccess: async () => {
      setOk('Исключение сохранено')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['schedule-exceptions'] })
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.status === 404 || e.status === 501)) {
        setError('API исключений расписания ещё не подключено')
        return
      }
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить')
    },
  })

  const deleteException = useMutation({
    mutationFn: () =>
      apiRequest(`/v1/me/schedule-exceptions/${selectedDay}`, {
        method: 'DELETE',
        token: accessToken,
      }),
    onSuccess: async () => {
      setOk('Исключение снято')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['schedule-exceptions'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось удалить'),
  })

  return (
    <main className="page stack">
      <div className="row between">
        <div className="stack-sm">
          <h1>Календарь</h1>
          <p className="muted">Записи и исключения расписания</p>
        </div>
        <Link className="btn btn-secondary btn-compact" to="/master">Рабочие часы</Link>
      </div>

      <div className="week-strip">
        {weekDays.map((d) => {
          const key = toKey(d)
          const count = (query.data?.items ?? []).filter((a) => dateKey(a.starts_at) === key).length
          const hasExc = (exceptions.data ?? []).some((e) => e.day.slice(0, 10) === key)
          return (
            <button
              key={key}
              type="button"
              className={`week-day ${selectedDay === key ? 'active' : ''}`}
              onClick={() => setSelectedDay(key)}
            >
              <span className="muted">{d.toLocaleDateString('ru-RU', { weekday: 'short' })}</span>
              <strong>{d.getDate()}</strong>
              <span className="muted">{count > 0 ? `${count}` : hasExc ? 'искл.' : '·'}</span>
            </button>
          )
        })}
      </div>

      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      <section className="stack">
        <h2>
          {new Date(`${selectedDay}T12:00:00`).toLocaleDateString('ru-RU', {
            weekday: 'long', day: 'numeric', month: 'long',
          })}
        </h2>
        {selectedException && (
          <p className="muted">
            {selectedException.is_day_off
              ? 'Выходной'
              : `Особые часы ${minutesLabel(selectedException.start_minute ?? 0)}–${minutesLabel(selectedException.end_minute ?? 0)}`}
            {selectedException.note ? ` · ${selectedException.note}` : ''}
          </p>
        )}
        {query.isLoading && <div className="state-box">Загрузка…</div>}
        {query.isError && <div className="state-box error">Не удалось загрузить записи</div>}
        {!query.isLoading && dayItems.length === 0 && (
          <div className="empty-state">
            <h2>Нет записей</h2>
            <p>На этот день клиенты ещё не записались.</p>
          </div>
        )}
        <div className="timeline">
          {dayItems.map((a) => (
            <Link key={a.id} to={`/appointments/${a.id}`} className="list-item timeline-item">
              <div className="row between">
                <strong>{a.service_name}</strong>
                <span className={`badge ${statusBadgeClass(a.status)}`}>{statusLabel(a.status)}</span>
              </div>
              <p>
                {new Date(a.starts_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                {' – '}
                {new Date(a.ends_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                {' · '}
                {formatMoney(a.price_minor)}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h2>Исключение на день</h2>
        <p className="muted">Выходной или свои часы вместо обычного расписания.</p>
        <div className="tabs">
          <button type="button" className={excMode === 'off' ? 'active' : ''} onClick={() => setExcMode('off')}>Выходной</button>
          <button type="button" className={excMode === 'custom' ? 'active' : ''} onClick={() => setExcMode('custom')}>Свои часы</button>
        </div>
        {excMode === 'custom' && (
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Начало</label>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Конец</label>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
        )}
        <div className="field">
          <label>Заметка</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Отпуск, обучение…" />
        </div>
        <div className="row">
          <button className="btn btn-primary" type="button" disabled={saveException.isPending} onClick={() => saveException.mutate()}>
            Сохранить исключение
          </button>
          {selectedException && (
            <button className="btn btn-secondary" type="button" disabled={deleteException.isPending} onClick={() => deleteException.mutate()}>
              Снять исключение
            </button>
          )}
        </div>
      </section>
    </main>
  )
}

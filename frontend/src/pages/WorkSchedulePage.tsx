import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiRequest } from '@/shared/api/client'
import { formatUserError } from '@/shared/lib/app-error'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { datetimeLocalToIso, isoToDatetimeLocal } from '@/shared/lib/time'
import { minutesToHHMM, parseHHMM, rangeToDayInterval } from '@/pages/calendar-helpers'
import {
  workModeLabel,
  type GeoCity,
  type GeoDistrict,
  type SalonChair,
  type WorkModeInterval,
} from '@/shared/lib/work-mode'

const WEEKDAYS = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 0, label: 'Вс' },
]

type HoursItem = { weekday: number; start_minute: number; end_minute: number }

export function WorkSchedulePage() {
  const { accessToken } = useAuth()
  const cabinet = useCabinet()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const orgId = cabinet.selectedOrg?.organization.id
  const branch = cabinet.selectedBranch
  const salonTz = branch?.timezone || 'Asia/Krasnoyarsk'
  const [mode, setMode] = useState<'chair' | 'onsite' | 'percentage'>('chair')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [chairId, setChairId] = useState('')
  const [cityId, setCityId] = useState('')
  const [districtIds, setDistrictIds] = useState<string[]>([])
  const [rate, setRate] = useState('50')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [hoursDraft, setHoursDraft] = useState<HoursItem[]>(
    WEEKDAYS.filter((d) => d.value >= 1 && d.value <= 5).map((d) => ({
      weekday: d.value,
      start_minute: 10 * 60,
      end_minute: 20 * 60,
    })),
  )
  const [exceptionDay, setExceptionDay] = useState('')
  const [exceptionStart, setExceptionStart] = useState('10:00')
  const [exceptionEnd, setExceptionEnd] = useState('18:00')
  const [exceptionOff, setExceptionOff] = useState(false)

  useEffect(() => {
    const startQ = params.get('start')
    const endQ = params.get('end')
    if (startQ) {
      try {
        setStart(isoToDatetimeLocal(startQ, salonTz))
        const interval = rangeToDayInterval(new Date(startQ), endQ ? new Date(endQ) : new Date(new Date(startQ).getTime() + 60 * 60 * 1000), salonTz)
        if (interval) {
          setExceptionDay(interval.day)
          setExceptionStart(minutesToHHMM(interval.start_minute))
          setExceptionEnd(minutesToHHMM(interval.end_minute >= 1440 ? 24 * 60 : interval.end_minute))
          setExceptionOff(false)
        }
      } catch {
        setStart(startQ.slice(0, 16))
      }
    }
    if (endQ) {
      try {
        setEnd(isoToDatetimeLocal(endQ, salonTz))
      } catch {
        setEnd(endQ.slice(0, 16))
      }
    }
  }, [params, salonTz])

  const range = useMemo(() => {
    const from = new Date()
    from.setDate(from.getDate() - 1)
    const to = new Date()
    to.setDate(to.getDate() + 45)
    return { from: from.toISOString(), to: to.toISOString() }
  }, [])

  const intervals = useQuery({
    queryKey: ['work-mode-intervals', range.from, range.to],
    queryFn: () => apiRequest<{ items: WorkModeInterval[] }>(
      `/v1/me/work-mode-intervals?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      { token: accessToken },
    ),
    enabled: Boolean(accessToken),
  })
  const hours = useQuery({
    queryKey: ['me-working-hours'],
    queryFn: () => apiRequest<{ items: HoursItem[] }>('/v1/me/working-hours', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  useEffect(() => {
    if (!hours.data?.items?.length) return
    setHoursDraft(hours.data.items)
  }, [hours.data])

  const chairs = useQuery({
    queryKey: ['usable-chairs', orgId],
    queryFn: () => apiRequest<{ items: SalonChair[] }>(
      `/v1/me/usable-chairs${orgId ? `?organization_id=${orgId}` : ''}`,
      { token: accessToken },
    ),
    enabled: Boolean(accessToken),
  })
  const cities = useQuery({
    queryKey: ['geo-cities'],
    queryFn: () => apiRequest<{ items: GeoCity[] }>('/v1/geo/cities', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const districts = useQuery({
    queryKey: ['geo-districts', cityId],
    queryFn: () => apiRequest<{ items: GeoDistrict[] }>(`/v1/geo/cities/${cityId}/districts`, { token: accessToken }),
    enabled: Boolean(accessToken && cityId),
  })

  const tz = useMemo(() => {
    if (mode === 'onsite') return cities.data?.items.find((c) => c.id === cityId)?.timezone || salonTz
    return salonTz
  }, [mode, cities.data, cityId, salonTz])

  const create = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        mode,
        starts_at: datetimeLocalToIso(start, tz),
        ends_at: datetimeLocalToIso(end, tz),
        timezone: tz,
      }
      if (mode === 'chair') body.chair_id = chairId
      if (mode === 'onsite') {
        body.city_id = cityId
        body.district_ids = districtIds
      }
      if (mode === 'percentage') {
        body.organization_id = orgId
        body.branch_id = branch?.id
        body.percentage_rate = Number(rate)
      }
      return apiRequest('/v1/me/work-mode-intervals', { method: 'POST', token: accessToken, body })
    },
    onSuccess: () => {
      setError(null)
      setOk('Интервал режима добавлен')
      setStart('')
      setEnd('')
      void qc.invalidateQueries({ queryKey: ['work-mode-intervals'] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось сохранить интервал')),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest(`/v1/me/work-mode-intervals/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-mode-intervals'] }),
  })

  const saveHours = useMutation({
    mutationFn: () => apiRequest('/v1/me/working-hours', {
      method: 'PUT',
      token: accessToken,
      body: { items: hoursDraft },
    }),
    onSuccess: async () => {
      setOk('Недельный график сохранён')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['me-working-hours'] })
      await qc.invalidateQueries({ queryKey: ['calendar-hours'] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось сохранить рабочие часы')),
  })

  const saveException = useMutation({
    mutationFn: () => {
      const startMin = parseHHMM(exceptionStart)
      const endMin = parseHHMM(exceptionEnd)
      if (!exceptionDay || (!exceptionOff && (startMin == null || endMin == null || endMin <= startMin))) {
        throw new Error('Укажите день и корректный интервал')
      }
      return apiRequest('/v1/me/schedule-exceptions', {
        method: 'PUT',
        token: accessToken,
        body: {
          items: [{
            day: exceptionDay,
            is_day_off: exceptionOff,
            start_minute: exceptionOff ? null : startMin,
            end_minute: exceptionOff ? null : endMin,
            note: exceptionOff ? 'Выходной' : 'Рабочий интервал',
          }],
        },
      })
    },
    onSuccess: async () => {
      setOk(exceptionOff ? 'Выходной сохранён' : 'Рабочий интервал сохранён')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['calendar-exceptions'] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось сохранить исключение')),
  })

  function toggleWeekday(weekday: number, enabled: boolean) {
    setHoursDraft((prev) => {
      if (enabled) {
        if (prev.some((h) => h.weekday === weekday)) return prev
        return [...prev, { weekday, start_minute: 10 * 60, end_minute: 20 * 60 }].sort((a, b) => a.weekday - b.weekday)
      }
      return prev.filter((h) => h.weekday !== weekday)
    })
  }

  function updateHour(weekday: number, patch: Partial<HoursItem>) {
    setHoursDraft((prev) => prev.map((h) => (h.weekday === weekday ? { ...h, ...patch } : h)))
  }

  return (
    <main className="page stack" data-testid="work-schedule-page">
      <h1>Установка графика</h1>
      <p className="muted">Недельные часы, исключения на день и режимы работы. Часовой пояс: {tz}.</p>
      {error && <ErrorBanner error={error} />}
      {ok && <div className="state-box success">{ok}</div>}

      <section className="card stack" data-testid="weekly-hours-form">
        <strong>Рабочие часы пн–вс</strong>
        <p className="muted">Базовый недельный график мастера.</p>
        {WEEKDAYS.map((d) => {
          const row = hoursDraft.find((h) => h.weekday === d.value)
          return (
            <div key={d.value} className="row gap wrap" style={{ alignItems: 'end' }}>
              <label className="field-check">
                <input
                  type="checkbox"
                  checked={Boolean(row)}
                  onChange={(e) => toggleWeekday(d.value, e.target.checked)}
                />
                <span>{d.label}</span>
              </label>
              {row ? (
                <>
                  <div className="field">
                    <label htmlFor={`wh-start-${d.value}`}>С</label>
                    <input
                      id={`wh-start-${d.value}`}
                      type="time"
                      step={1800}
                      value={minutesToHHMM(row.start_minute)}
                      onChange={(e) => {
                        const m = parseHHMM(e.target.value)
                        if (m != null) updateHour(d.value, { start_minute: m })
                      }}
                      aria-required="true"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`wh-end-${d.value}`}>До</label>
                    <input
                      id={`wh-end-${d.value}`}
                      type="time"
                      step={1800}
                      value={minutesToHHMM(row.end_minute)}
                      onChange={(e) => {
                        const m = parseHHMM(e.target.value)
                        if (m != null) updateHour(d.value, { end_minute: m })
                      }}
                      aria-required="true"
                    />
                  </div>
                </>
              ) : (
                <span className="muted">выходной</span>
              )}
            </div>
          )
        })}
        <button className="btn btn-primary" type="button" disabled={saveHours.isPending || hoursDraft.length === 0} onClick={() => saveHours.mutate()}>
          Сохранить недельный график
        </button>
      </section>

      <section className="card stack" data-testid="day-exception-form">
        <strong>Интервал на конкретный день</strong>
        <p className="muted">Сохраняется как исключение графика (поверх недельных часов).</p>
        <div className="field">
          <label htmlFor="ex-day">День</label>
          <input id="ex-day" type="date" value={exceptionDay} onChange={(e) => setExceptionDay(e.target.value)} aria-required="true" />
        </div>
        <label className="field-check">
          <input type="checkbox" checked={exceptionOff} onChange={(e) => setExceptionOff(e.target.checked)} />
          <span>Выходной</span>
        </label>
        {!exceptionOff ? (
          <div className="row gap wrap">
            <div className="field">
              <label htmlFor="ex-start">С</label>
              <input id="ex-start" type="time" step={1800} value={exceptionStart} onChange={(e) => setExceptionStart(e.target.value)} aria-required="true" />
            </div>
            <div className="field">
              <label htmlFor="ex-end">До</label>
              <input id="ex-end" type="time" step={1800} value={exceptionEnd} onChange={(e) => setExceptionEnd(e.target.value)} aria-required="true" />
            </div>
          </div>
        ) : null}
        <button className="btn btn-secondary" type="button" disabled={saveException.isPending || !exceptionDay} onClick={() => saveException.mutate()}>
          Сохранить рабочий интервал
        </button>
      </section>

      <section className="card stack" data-testid="work-mode-form">
        <strong>Режим работы</strong>
        <p className="muted">Кресло / выезд / проценты на выбранный интервал.</p>
        <div className="field">
          <label htmlFor="work-mode">Режим</label>
          <select id="work-mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="chair">В салоне</option>
            <option value="onsite">Выезд</option>
            <option value="percentage">На процентах</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="wm-start">Начало</label>
          <input id="wm-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} aria-required="true" />
        </div>
        <div className="field">
          <label htmlFor="wm-end">Конец</label>
          <input id="wm-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} aria-required="true" />
        </div>
        {mode === 'chair' && (
          <div className="field">
            <label htmlFor="wm-chair">Кресло</label>
            <select id="wm-chair" value={chairId} onChange={(e) => setChairId(e.target.value)}>
              <option value="">Выберите кресло</option>
              {(chairs.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
        {mode === 'onsite' && (
          <>
            <div className="field">
              <label htmlFor="wm-city">Город</label>
              <select id="wm-city" value={cityId} onChange={(e) => { setCityId(e.target.value); setDistrictIds([]) }}>
                <option value="">Выберите город</option>
                {(cities.data?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <fieldset className="field">
              <legend>Районы</legend>
              {(districts.data?.items ?? []).map((d) => (
                <label key={d.id} className="field-check">
                  <input
                    type="checkbox"
                    checked={districtIds.includes(d.id)}
                    onChange={(e) => setDistrictIds((prev) => e.target.checked ? [...prev, d.id] : prev.filter((id) => id !== d.id))}
                  />
                  <span>{d.name}</span>
                </label>
              ))}
            </fieldset>
          </>
        )}
        {mode === 'percentage' && (
          <div className="field">
            <label htmlFor="wm-rate">Процент от стоимости услуги</label>
            <input id="wm-rate" type="number" min={1} max={100} value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
        )}
        <button className="btn btn-primary" type="button" data-testid="save-work-mode" disabled={create.isPending} onClick={() => create.mutate()}>
          Добавить интервал
        </button>
      </section>
      <section className="stack">
        {(intervals.data?.items ?? []).map((it) => (
          <article key={it.id} className="card stack" data-testid="work-mode-item">
            <strong>{it.mode_label || workModeLabel(it.mode)}</strong>
            <p>{new Date(it.starts_at).toLocaleString('ru-RU')} — {new Date(it.ends_at).toLocaleString('ru-RU')}</p>
            {it.location_label && <p className="muted">{it.location_label}</p>}
            <button className="btn" type="button" onClick={() => remove.mutate(it.id)}>Удалить</button>
          </article>
        ))}
      </section>
    </main>
  )
}

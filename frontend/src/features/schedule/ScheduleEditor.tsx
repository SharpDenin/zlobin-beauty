import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '@/shared/api/client'
import { formatUserError } from '@/shared/lib/app-error'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { toast } from '@/shared/ui/Toast'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { datetimeLocalToIso, isoToDatetimeLocal } from '@/shared/lib/time'
import { resolveServiceTimezone } from '@/shared/lib/service-timezone'
import { minutesToHHMM, parseHHMM, rangeToDayInterval } from '@/pages/calendar-helpers'
import {
  workModeLabel,
  type GeoCity,
  type GeoDistrict,
  type SalonChair,
  type WorkModeInterval,
} from '@/shared/lib/work-mode'
import { TimeSelect } from '@/shared/ui/TimeSelect'

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

export type ScheduleEditorTab = 'hours' | 'exception' | 'modes'

type Props = {
  /** Which panel to emphasize / scroll into view on open. */
  tab?: ScheduleEditorTab
  /** Prefill exception / work-mode interval from a pressed calendar slot. */
  initialStart?: string | null
  initialEnd?: string | null
  /** Hide page chrome when embedded in a drawer. */
  embedded?: boolean
  /**
   * Owner calendar: edit another master's hours/exceptions via
   * `/v1/calendar/working-hours` + `/v1/calendar/schedule-exceptions`
   * (same StaffPage targeting). Omit for master self-schedule (`/v1/me/*`).
   */
  targetMasterUserId?: string
  targetOrganizationId?: string
  onSaved?: () => void
}

export function ScheduleEditor({
  tab = 'hours',
  initialStart = null,
  initialEnd = null,
  embedded = false,
  targetMasterUserId,
  targetOrganizationId,
  onSaved,
}: Props) {
  const { accessToken, user } = useAuth()
  const cabinet = useCabinet()
  const qc = useQueryClient()
  const orgId = targetOrganizationId || cabinet.selectedOrg?.organization.id
  const branch = cabinet.selectedBranch
  const salonTz = resolveServiceTimezone(branch?.timezone, branch?.city)
  const staffTarget =
    Boolean(targetMasterUserId && targetOrganizationId && targetMasterUserId !== user?.id)
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
  const [activeTab, setActiveTab] = useState<ScheduleEditorTab>(tab)

  useEffect(() => {
    setActiveTab(tab)
  }, [tab])

  useEffect(() => {
    if (!initialStart) return
    try {
      setStart(isoToDatetimeLocal(initialStart, salonTz))
      const interval = rangeToDayInterval(
        new Date(initialStart),
        initialEnd ? new Date(initialEnd) : new Date(new Date(initialStart).getTime() + 60 * 60 * 1000),
        salonTz,
      )
      if (interval) {
        setExceptionDay(interval.day)
        setExceptionStart(minutesToHHMM(interval.start_minute))
        setExceptionEnd(minutesToHHMM(interval.end_minute >= 1440 ? 24 * 60 : interval.end_minute))
        setExceptionOff(false)
      }
    } catch {
      setStart(initialStart.slice(0, 16))
    }
    if (initialEnd) {
      try {
        setEnd(isoToDatetimeLocal(initialEnd, salonTz))
      } catch {
        setEnd(initialEnd.slice(0, 16))
      }
    }
  }, [initialStart, initialEnd, salonTz])

  useEffect(() => {
    const id = `schedule-panel-${activeTab}`
    const el = document.getElementById(id)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeTab])

  const range = useMemo(() => {
    const from = new Date()
    from.setDate(from.getDate() - 1)
    const to = new Date()
    to.setDate(to.getDate() + 45)
    return { from: from.toISOString(), to: to.toISOString() }
  }, [])

  const intervals = useQuery({
    queryKey: ['work-mode-intervals', range.from, range.to, staffTarget ? targetMasterUserId : 'me', orgId],
    queryFn: () => {
      const qs = new URLSearchParams({ from: range.from, to: range.to })
      if (staffTarget && orgId && targetMasterUserId) {
        qs.set('organization_id', orgId)
        qs.set('master_user_id', targetMasterUserId)
        return apiRequest<{ items: WorkModeInterval[] }>(
          `/v1/calendar/work-mode-intervals?${qs.toString()}`,
          { token: accessToken },
        )
      }
      return apiRequest<{ items: WorkModeInterval[] }>(
        `/v1/me/work-mode-intervals?${qs.toString()}`,
        { token: accessToken },
      )
    },
    enabled: Boolean(accessToken),
  })
  const hours = useQuery({
    queryKey: ['schedule-working-hours', staffTarget ? targetMasterUserId : 'me', orgId],
    queryFn: () => {
      if (staffTarget && orgId && targetMasterUserId) {
        return apiRequest<{ items: HoursItem[] }>(
          `/v1/calendar/working-hours?organization_id=${orgId}&master_user_id=${targetMasterUserId}`,
          { token: accessToken },
        )
      }
      return apiRequest<{ items: HoursItem[] }>('/v1/me/working-hours', { token: accessToken })
    },
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
      if (staffTarget) {
        throw new Error('Режимы работы мастера редактируются в его кабинете')
      }
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
      toast.success('Интервал режима добавлен')
      setStart('')
      setEnd('')
      void qc.invalidateQueries({ queryKey: ['work-mode-intervals'] })
      onSaved?.()
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось сохранить интервал')),
  })

  const remove = useMutation({
    mutationFn: (id: string) => {
      if (staffTarget) {
        throw new Error('Режимы работы мастера редактируются в его кабинете')
      }
      return apiRequest(`/v1/me/work-mode-intervals/${id}`, { method: 'DELETE', token: accessToken })
    },
    onSuccess: () => {
      toast.success('Интервал режима удалён')
      void qc.invalidateQueries({ queryKey: ['work-mode-intervals'] })
    },
  })

  const saveHours = useMutation({
    mutationFn: () => {
      if (staffTarget && orgId && targetMasterUserId) {
        return apiRequest(
          `/v1/calendar/working-hours?organization_id=${orgId}&master_user_id=${targetMasterUserId}`,
          {
            method: 'PUT',
            token: accessToken,
            body: { items: hoursDraft },
          },
        )
      }
      return apiRequest('/v1/me/working-hours', {
        method: 'PUT',
        token: accessToken,
        body: { items: hoursDraft },
      })
    },
    onSuccess: async () => {
      setOk('Недельный график сохранён')
      toast.success('Недельный график сохранён')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['schedule-working-hours'] })
      await qc.invalidateQueries({ queryKey: ['me-working-hours'] })
      await qc.invalidateQueries({ queryKey: ['calendar-hours'] })
      onSaved?.()
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
      const body = {
        items: [{
          day: exceptionDay,
          is_day_off: exceptionOff,
          start_minute: exceptionOff ? null : startMin,
          end_minute: exceptionOff ? null : endMin,
          note: exceptionOff ? 'Выходной' : 'Рабочий интервал',
        }],
      }
      if (staffTarget && orgId && targetMasterUserId) {
        return apiRequest(
          `/v1/calendar/schedule-exceptions?organization_id=${orgId}&master_user_id=${targetMasterUserId}`,
          { method: 'PUT', token: accessToken, body },
        )
      }
      return apiRequest('/v1/me/schedule-exceptions', {
        method: 'PUT',
        token: accessToken,
        body,
      })
    },
    onSuccess: async () => {
      const msg = exceptionOff ? 'Выходной сохранён' : 'Рабочий интервал сохранён'
      setOk(msg)
      toast.success(msg)
      setError(null)
      await qc.invalidateQueries({ queryKey: ['calendar-exceptions'] })
      onSaved?.()
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

  const body = (
    <div
      className="stack schedule-editor"
      data-testid="schedule-editor"
      data-schedule-target={staffTarget ? targetMasterUserId : 'self'}
    >
      {!embedded ? (
        <>
          <h1>Установка графика</h1>
          <p className="muted">Недельные часы, исключения на день и режимы работы.</p>
        </>
      ) : (
        <p className="muted">
          {staffTarget
            ? 'График выбранного мастера: часы и исключения (как в разделе «Команда»).'
            : 'Недельные часы, исключения на день и режимы работы.'}
        </p>
      )}
      {staffTarget ? (
        <p className="muted" data-testid="schedule-editor-target-hint">
          Цель: мастер <code data-testid="schedule-editor-target-master">{targetMasterUserId}</code>
        </p>
      ) : null}
      {error && <ErrorBanner error={error} />}
      {ok && <div className="state-box success">{ok}</div>}

      <div className="calendar-view-tabs" role="tablist" aria-label="Разделы графика">
        {([
          ['hours', 'Часы'],
          ['exception', 'День'],
          ['modes', 'Режимы'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={`chip ${activeTab === id ? 'active' : ''}`}
            aria-selected={activeTab === id}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="card stack" data-testid="weekly-hours-form" id="schedule-panel-hours">
        <strong>Рабочие часы пн–вс</strong>
        <p className="muted">Базовый недельный график мастера.</p>
        {WEEKDAYS.map((d) => {
          const row = hoursDraft.find((h) => h.weekday === d.value)
          return (
            <div key={d.value} className="schedule-hours-row">
              <label className="field-check schedule-hours-day">
                <input
                  type="checkbox"
                  checked={Boolean(row)}
                  onChange={(e) => toggleWeekday(d.value, e.target.checked)}
                />
                <span>{d.label}</span>
              </label>
              {row ? (
                <div className="field-pair">
                  <div className="field">
                    <label htmlFor={`wh-start-${d.value}`}>С</label>
                    <TimeSelect
                      id={`wh-start-${d.value}`}
                      value={minutesToHHMM(row.start_minute)}
                      onChange={(next) => {
                        const m = parseHHMM(next)
                        if (m != null) updateHour(d.value, { start_minute: m })
                      }}
                      aria-required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`wh-end-${d.value}`}>До</label>
                    <TimeSelect
                      id={`wh-end-${d.value}`}
                      value={minutesToHHMM(row.end_minute)}
                      onChange={(next) => {
                        const m = parseHHMM(next)
                        if (m != null) updateHour(d.value, { end_minute: m })
                      }}
                      aria-required
                    />
                  </div>
                </div>
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

      <section className="card stack" data-testid="day-exception-form" id="schedule-panel-exception">
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
          <div className="field-pair">
            <div className="field">
              <label htmlFor="ex-start">С</label>
              <TimeSelect id="ex-start" value={exceptionStart} onChange={setExceptionStart} aria-required />
            </div>
            <div className="field">
              <label htmlFor="ex-end">До</label>
              <TimeSelect id="ex-end" value={exceptionEnd} onChange={setExceptionEnd} aria-required />
            </div>
          </div>
        ) : null}
        <button className="btn btn-secondary" type="button" disabled={saveException.isPending || !exceptionDay} onClick={() => saveException.mutate()}>
          Сохранить рабочий интервал
        </button>
      </section>

      <section className="card stack" data-testid="work-mode-form" id="schedule-panel-modes">
        <strong>Режим работы</strong>
        {staffTarget ? (
          <p className="muted">Просмотр интервалов мастера. Создание и удаление режимов — в кабинете мастера.</p>
        ) : (
          <p className="muted">Кресло / выезд / проценты на выбранный интервал.</p>
        )}
        {!staffTarget ? (
          <>
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
          </>
        ) : null}
      </section>
      <section className="stack">
        {(intervals.data?.items ?? []).map((it) => (
          <article key={it.id} className="card stack" data-testid="work-mode-item">
            <strong>{it.mode_label || workModeLabel(it.mode)}</strong>
            <p>{new Date(it.starts_at).toLocaleString('ru-RU')} — {new Date(it.ends_at).toLocaleString('ru-RU')}</p>
            {it.location_label && <p className="muted">{it.location_label}</p>}
            {!staffTarget ? (
              <button className="btn" type="button" onClick={() => remove.mutate(it.id)}>Удалить</button>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  )

  return body
}

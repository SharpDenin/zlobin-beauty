import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { datetimeLocalToIso } from '@/shared/lib/time'
import {
  workModeLabel,
  type GeoCity,
  type GeoDistrict,
  type SalonChair,
  type WorkModeInterval,
} from '@/shared/lib/work-mode'

export function WorkSchedulePage() {
  const { accessToken } = useAuth()
  const cabinet = useCabinet()
  const qc = useQueryClient()
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
      setStart('')
      setEnd('')
      void qc.invalidateQueries({ queryKey: ['work-mode-intervals'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось сохранить интервал'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest(`/v1/me/work-mode-intervals/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-mode-intervals'] }),
  })

  return (
    <main className="page stack">
      <h1>График режимов работы</h1>
      <p className="muted">Время сохраняется в часовом поясе салона или города выезда, не в поясе браузера. Сейчас: {tz}.</p>
      {error && <div className="state-box error">{error}</div>}
      <section className="card stack" data-testid="work-mode-form">
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
          <input id="wm-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="wm-end">Конец</label>
          <input id="wm-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
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

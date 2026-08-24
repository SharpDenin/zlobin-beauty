import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { Hint } from '@/shared/ui/Hint'
import { masterProfessionLabel } from '@/shared/lib/profession-types'
import { type GeoCity, type GeoDistrict } from '@/shared/lib/work-mode'

type Master = {
  id: string
  user_id: string
  display_name: string
  city: string
  specializations: string[]
  profession_types?: { id: string; slug: string; name: string }[]
  rating_avg: number
  rating_count: number
  onsite_match?: { city: string; districts: string[]; badge: string }
}

type Filters = {
  city: string
  q: string
  service: string
  price_min: string
  price_max: string
  available_on: string
  include_other_cities: boolean
  district_id: string
}

const DEFAULT_CITY = 'Красноярск'

function buildMastersUrl(f: Filters): string {
  const params = new URLSearchParams()
  params.set('city', f.city)
  if (f.q) params.set('q', f.q)
  if (f.service) params.set('service', f.service)
  const minRub = f.price_min.trim() === '' ? null : Number(f.price_min)
  const maxRub = f.price_max.trim() === '' ? null : Number(f.price_max)
  if (minRub !== null && Number.isFinite(minRub)) params.set('price_min', String(Math.round(minRub * 100)))
  if (maxRub !== null && Number.isFinite(maxRub)) params.set('price_max', String(Math.round(maxRub * 100)))
  if (f.available_on) params.set('available_on', f.available_on)
  if (f.district_id) params.set('district_id', f.district_id)
  if (f.include_other_cities) params.set('include_other_cities', 'true')
  return `/v1/masters?${params.toString()}`
}

export function SearchPage() {
  const { user } = useAuth()
  const defaultCity = user?.city?.trim() || DEFAULT_CITY
  const [city, setCity] = useState(defaultCity)
  const [q, setQ] = useState('')
  const [service, setService] = useState('')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [availableOn, setAvailableOn] = useState('')
  const [districtId, setDistrictId] = useState('')
  const [includeOtherCities, setIncludeOtherCities] = useState(false)
  const [submitted, setSubmitted] = useState<Filters>({
    city: defaultCity,
    q: '',
    service: '',
    price_min: '',
    price_max: '',
    available_on: '',
    include_other_cities: false,
    district_id: '',
  })

  useEffect(() => {
    const next = user?.city?.trim() || DEFAULT_CITY
    setCity(next)
    setSubmitted((prev) => (prev.q || prev.service || prev.price_min || prev.price_max || prev.available_on || prev.include_other_cities
      ? prev
      : { ...prev, city: next }))
  }, [user?.city])

  const query = useQuery({
    queryKey: ['masters', submitted],
    queryFn: () => apiRequest<{ items: Master[] }>(buildMastersUrl(submitted)),
  })
  const cities = useQuery({
    queryKey: ['geo-cities'],
    queryFn: () => apiRequest<{ items: GeoCity[] }>('/v1/geo/cities'),
  })
  const cityId = cities.data?.items.find((c) => c.name.toLowerCase() === city.trim().toLowerCase())?.id
  const districts = useQuery({
    queryKey: ['geo-districts', cityId],
    queryFn: () => apiRequest<{ items: GeoDistrict[] }>(`/v1/geo/cities/${cityId}/districts`),
    enabled: Boolean(cityId),
  })

  const selectedCity = submitted.city.trim().toLowerCase()

  return (
    <main className="page stack">
      <h1>Поиск мастеров <Hint id="client-booking" title="Запись">Найдите мастера по городу и услуге, затем выберите время на карточке.</Hint></h1>
      <form
        className="card search-form"
        onSubmit={(e) => {
          e.preventDefault()
          setSubmitted({
            city: city.trim() || defaultCity,
            q: q.trim(),
            service: service.trim(),
            price_min: priceMin.trim(),
            price_max: priceMax.trim(),
            available_on: availableOn,
            include_other_cities: includeOtherCities,
            district_id: districtId,
          })
        }}
      >
        <div className="field">
          <label htmlFor="city">Город</label>
          <input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="q">Имя или специализация</label>
          <input id="q" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="service">Услуга</label>
          <input id="service" value={service} onChange={(e) => setService(e.target.value)} placeholder="Стрижка" />
        </div>
        <div className="field">
          <label htmlFor="price_min">Цена от, ₽</label>
          <input id="price_min" type="number" min={0} value={priceMin} onChange={(e) => setPriceMin(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="price_max">Цена до, ₽</label>
          <input id="price_max" type="number" min={0} value={priceMax} onChange={(e) => setPriceMax(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="available_on">Свободен на дату</label>
          <input id="available_on" type="date" value={availableOn} onChange={(e) => setAvailableOn(e.target.value)} />
        </div>
        {!!districts.data?.items.length && (
          <div className="field">
            <label htmlFor="district_id">Район</label>
            <select id="district_id" value={districtId} onChange={(e) => setDistrictId(e.target.value)}>
              <option value="">Любой район</option>
              {districts.data.items.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="field switch-field">
          <label className="switch" htmlFor="include_other_cities">
            <input
              id="include_other_cities"
              type="checkbox"
              checked={includeOtherCities}
              onChange={(e) => setIncludeOtherCities(e.target.checked)}
            />
            <span className="switch-track" aria-hidden />
            <span className="switch-label">Показывать мастеров из других городов</span>
          </label>
        </div>
        <button className="btn btn-primary" type="submit">Искать</button>
      </form>

      {query.isLoading && <div className="state-box">Ищем мастеров…</div>}
      {query.isError && <div className="state-box error">Не удалось загрузить список</div>}
      {query.data && query.data.items.length === 0 && (
        <div className="state-box">Пока нет опубликованных мастеров в этом городе</div>
      )}
      <div className="list">
        {query.data?.items.map((m) => {
          const otherCity = m.city.trim().toLowerCase() !== selectedCity
          return (
            <Link key={m.id} to={`/masters/${m.id}`} className="list-item">
              <div className="row between">
                <strong>{m.display_name}</strong>
                <span className={`city-badge${otherCity ? ' city-badge--other' : ''}`}>{m.city}</span>
              </div>
              <p>{masterProfessionLabel(m, 'Специализации не указаны')}</p>
              <p className="muted">★ {m.rating_avg.toFixed(1)} ({m.rating_count})</p>
              {m.onsite_match && (
                <p className="badge badge-success" data-testid="onsite-badge">{m.onsite_match.badge || 'Выезд в вашем районе'}</p>
              )}
            </Link>
          )
        })}
      </div>
    </main>
  )
}

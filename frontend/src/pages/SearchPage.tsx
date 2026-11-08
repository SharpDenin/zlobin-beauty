import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { Hint } from '@/shared/ui/Hint'
import { type GeoCity, type GeoDistrict } from '@/shared/lib/work-mode'
import { formatMoney } from '@/shared/lib/money'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ServiceCardMedia } from '@/shared/ui/ServiceCardMedia'
import { SearchField } from '@/shared/ui/SearchField'
import '@/features/media-cards/media-cards.css'

type Master = {
  id: string
  user_id: string
  display_name: string
  city: string
  specializations: string[]
  profession_types?: { id: string; slug: string; name: string }[]
  rating_avg: number
  rating_count: number
  photo_media_id?: string | null
  service_names?: string[]
  price_min_minor?: number | null
  price_max_minor?: number | null
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

type SearchResponse = {
  items: Master[]
  has_more?: boolean
  next_cursor?: string
}

const DEFAULT_CITY = 'Красноярск'
const PAGE_LIMIT = 20

function buildMastersUrl(f: Filters, cursor?: string): string {
  const params = new URLSearchParams()
  params.set('city', f.city)
  params.set('limit', String(PAGE_LIMIT))
  if (f.q) params.set('q', f.q)
  if (f.service) params.set('service', f.service)
  const minRub = f.price_min.trim() === '' ? null : Number(f.price_min)
  const maxRub = f.price_max.trim() === '' ? null : Number(f.price_max)
  if (minRub !== null && Number.isFinite(minRub)) params.set('price_min', String(Math.round(minRub * 100)))
  if (maxRub !== null && Number.isFinite(maxRub)) params.set('price_max', String(Math.round(maxRub * 100)))
  if (f.available_on) params.set('available_on', f.available_on)
  if (f.district_id) params.set('district_id', f.district_id)
  if (f.include_other_cities) params.set('include_other_cities', 'true')
  if (cursor) params.set('cursor', cursor)
  return `/v1/masters?${params.toString()}`
}

function masterDisplayName(m: Master): string {
  const name = m.display_name?.trim()
  return name || 'Мастер'
}

function servicesLine(m: Master): string | null {
  const names = (m.service_names ?? []).map((n) => n.trim()).filter(Boolean)
  if (!names.length) return null
  return names.join(' · ')
}

function priceRangeLine(m: Master): string | null {
  const min = m.price_min_minor
  const max = m.price_max_minor
  if (min == null || max == null) return null
  if (min === max) return formatMoney(min)
  return `${formatMoney(min)} – ${formatMoney(max)}`
}

function locationLine(m: Master, selectedCity: string): { city: string; district?: string; otherCity: boolean } {
  const city = m.city?.trim() || 'Город не указан'
  const otherCity = city.toLowerCase() !== selectedCity
  const districts = (m.onsite_match?.districts ?? []).map((d) => d.trim()).filter(Boolean)
  return { city, district: districts[0], otherCity }
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

  const query = useInfiniteQuery({
    queryKey: ['masters', submitted],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => apiRequest<SearchResponse>(buildMastersUrl(submitted, pageParam)),
    getNextPageParam: (last) => (last.has_more && last.next_cursor ? last.next_cursor : undefined),
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
  const items = query.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <main className="page stack">
      <h1>Поиск мастера <Hint id="client-booking" title="Запись">Найдите мастера по городу и услуге, затем выберите время на карточке.</Hint></h1>
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
        <SearchField
          id="q"
          label="Имя, специализация или работа"
          value={q}
          onChange={setQ}
          placeholder="Имя, специализация или работа"
          clearable
        />
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
      {query.isError && <ErrorBanner error={query.error} fallbackTitle="Не удалось загрузить список" />}
      {query.isSuccess && items.length === 0 && (
        <EmptyState title="Мастера не найдены" text="Попробуйте изменить город или сбросить фильтры." />
      )}
      <div className="list">
        {items.map((m) => {
          const name = masterDisplayName(m)
          const services = servicesLine(m)
          const prices = priceRangeLine(m)
          const loc = locationLine(m, selectedCity)
          const isSelf = Boolean(user?.id && m.user_id === user.id)
          return (
            <Link
              key={m.id}
              to={`/masters/${m.id}`}
              className="list-item search-master-card media-first-card"
              data-testid={isSelf ? 'search-master-self' : 'search-master-card'}
            >
              <ServiceCardMedia
                mediaId={m.photo_media_id}
                name={name}
                aspect="hero"
                overlay={{
                  title: name,
                  meta: `★ ${m.rating_avg.toFixed(1)} (${m.rating_count})`,
                }}
              />
              <div className="media-first-body stack-sm">
                <div className="search-master-location">
                  {loc.district && (
                    <span className="search-master-district" data-testid="search-onsite-district">{loc.district}</span>
                  )}
                  <span className={`city-badge${loc.otherCity ? ' city-badge--other' : ''}`}>{loc.city}</span>
                  {isSelf && (
                    <span className="badge badge-default" data-testid="search-self-badge">Это вы</span>
                  )}
                </div>
                {services && (
                  <p className="search-master-services" data-testid="search-master-services">{services}</p>
                )}
                {prices && (
                  <p className="search-master-price" data-testid="search-master-price">{prices}</p>
                )}
                {m.onsite_match && (
                  <p className="badge badge-success" data-testid="onsite-badge">{m.onsite_match.badge || 'Выезд в вашем районе'}</p>
                )}
              </div>
            </Link>
          )
        })}
      </div>
      {query.hasNextPage && (
        <button
          type="button"
          className="btn btn-secondary btn-block"
          data-testid="search-load-more"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'}
        </button>
      )}
    </main>
  )
}

export const searchPageHelpers = { masterDisplayName, servicesLine, priceRangeLine, locationLine, buildMastersUrl }

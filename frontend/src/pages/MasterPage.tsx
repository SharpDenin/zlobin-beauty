import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { apiRequest, ApiError } from '@/shared/api/client'
import { userError } from '@/shared/lib/app-error'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { masterProfessionLabel } from '@/shared/lib/profession-types'
import { formatDualTime, formatRangeInTimezone } from '@/shared/lib/time'
import { MediaImage } from '@/shared/ui/MediaImage'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { EmptyState } from '@/shared/ui/EmptyState'
import { useToast } from '@/shared/ui/Toast'
import { Hint } from '@/shared/ui/Hint'
import { useMessenger } from '@/features/messenger/MessengerProvider'
import { MultiServiceBookingDialog } from '@/pages/MultiServiceBookingDialog'
import { canJoinMultiService } from '@/pages/visit-plan-helpers'
import {
  PortfolioCategoryChips,
  PortfolioGrid,
  PortfolioViewer,
} from '@/features/portfolio/PortfolioUI'
import {
  collectPortfolioCategories,
  filterPortfolioByCategory,
  type PortfolioListResponse,
} from '@/features/portfolio/types'
import '@/features/master-profile/master-profile.css'
import '@/features/portfolio/portfolio.css'
import '@/features/media-cards/media-cards.css'

type BookingMode = 'flexible' | 'fixed_window'

type Service = {
  id: string
  name: string
  category: string
  duration_minutes: number
  price_minor: number
  price_display: string
  description?: string
  booking_mode?: BookingMode | string
  photo_media_id?: string | null
}

type MasterDetails = {
  master: {
    id: string
    user_id: string
    display_name: string
    bio: string
    city: string
    specializations: string[]
    work_type?: string
    profession_types?: { id: string; slug: string; name: string }[]
    photo_media_id?: string | null
    organization_id?: string
    experience_years?: number
    rating_avg?: number
    rating_count?: number
  }
  services: Service[]
}

type Slot = { starts_at: string; ends_at: string }

type Occurrence = {
  id: string
  service_id: string
  starts_at: string
  ends_at: string
  timezone: string
  capacity: number
  booked_count: number
  remaining: number
  status: string
  title?: string
}

type BookedAppointment = {
  id: string
  status?: string
  location_name?: string
  location_city?: string
  location_address?: string
  location_timezone?: string
  booking_mode?: string
}

type Review = {
  id: string
  master_rating: number
  result_rating: number
  comment: string
  created_at: string
}

const FLEX_STEPS = ['Услуга', 'Дата', 'Время', 'Итого'] as const
const FIXED_STEPS = ['Услуга', 'Сеанс', 'Итого'] as const

function bookingModeLabel(mode?: string) {
  return mode === 'fixed_window' ? 'Фиксированное окно' : 'Гибкая запись'
}

function nearbyDates(centerISO: string, span = 7): string[] {
  const base = new Date(`${centerISO}T12:00:00`)
  const out: string[] = []
  for (let i = -1; i < span - 1; i++) {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (d < today) continue
    out.push(d.toISOString().slice(0, 10))
  }
  while (out.length < span) {
    const last = out[out.length - 1] ? new Date(`${out[out.length - 1]}T12:00:00`) : new Date()
    last.setDate(last.getDate() + 1)
    out.push(last.toISOString().slice(0, 10))
  }
  return out.slice(0, span)
}

function ratingDistribution(reviews: Review[]): number[] {
  const counts = [0, 0, 0, 0, 0]
  for (const r of reviews) {
    const star = Math.min(5, Math.max(1, Math.round(r.master_rating)))
    counts[5 - star] += 1
  }
  return counts
}

export function MasterPage() {
  const { id } = useParams()
  const { accessToken, user } = useAuth()
  const messenger = useMessenger()
  const qc = useQueryClient()
  const toast = useToast()
  const [step, setStep] = useState(0)
  const [serviceId, setServiceId] = useState<string>('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [slot, setSlot] = useState<string>('')
  const [occurrenceId, setOccurrenceId] = useState<string>('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [booked, setBooked] = useState<BookedAppointment | null>(null)
  const [multiOpen, setMultiOpen] = useState(false)
  const [aboutExpanded, setAboutExpanded] = useState(false)
  const [portfolioCategory, setPortfolioCategory] = useState('Все')
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerIndex, setViewerIndex] = useState(0)
  const [bookingFocus, setBookingFocus] = useState(false)

  const masterQuery = useQuery({
    queryKey: ['master', id],
    queryFn: () => apiRequest<MasterDetails>(`/v1/masters/${id}`),
    enabled: Boolean(id),
  })

  const selectedService = useMemo(
    () => masterQuery.data?.services.find((s) => s.id === serviceId),
    [masterQuery.data, serviceId],
  )

  const isFixed = selectedService?.booking_mode === 'fixed_window'
  const steps = isFixed ? FIXED_STEPS : FLEX_STEPS

  const slotsQuery = useQuery({
    queryKey: ['slots', masterQuery.data?.master.user_id, date, selectedService?.duration_minutes],
    queryFn: () =>
      apiRequest<{ items: Slot[] }>(
        `/v1/masters/${masterQuery.data!.master.user_id}/slots?date=${date}&duration_minutes=${selectedService!.duration_minutes}`,
      ),
    enabled: Boolean(masterQuery.data?.master.user_id && selectedService && !isFixed && (step >= 2 || bookingFocus)),
  })

  const occurrencesQuery = useQuery({
    queryKey: ['service-occurrences', serviceId],
    queryFn: () => apiRequest<{ items: Occurrence[] }>(`/v1/services/${serviceId}/occurrences`),
    enabled: Boolean(serviceId && isFixed && step >= 1),
  })

  const selectedOccurrence = useMemo(
    () => occurrencesQuery.data?.items.find((o) => o.id === occurrenceId),
    [occurrencesQuery.data, occurrenceId],
  )

  const reviewsQuery = useQuery({
    queryKey: ['master-reviews', masterQuery.data?.master.user_id],
    queryFn: () =>
      apiRequest<{ items: Review[] }>(`/v1/masters/${masterQuery.data!.master.user_id}/reviews`),
    enabled: Boolean(masterQuery.data?.master.user_id),
  })

  const portfolioQuery = useQuery({
    queryKey: ['master-portfolio', id],
    queryFn: () => apiRequest<PortfolioListResponse>(`/v1/masters/${id}/portfolio`),
    enabled: Boolean(id),
  })

  const book = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new ApiError('Требуется вход', 'unauthorized', 401)
      const body = isFixed
        ? {
            master_id: id,
            service_id: serviceId,
            occurrence_id: occurrenceId,
            starts_at: selectedOccurrence!.starts_at,
          }
        : {
            master_id: id,
            service_id: serviceId,
            starts_at: slot,
          }
      return apiRequest<BookedAppointment>('/v1/appointments', {
        token: accessToken,
        body,
        idempotencyKey: crypto.randomUUID(),
      })
    },
    onSuccess: async (res) => {
      const confirmed = res.status === 'confirmed'
      setMessage(confirmed ? 'Запись подтверждена автоматически' : 'Запись создана и ожидает подтверждения мастера')
      setError(null)
      setBooked(res)
      setDone(true)
      toast.success(confirmed ? 'Запись подтверждена' : 'Запись отправлена мастеру')
      await qc.invalidateQueries({ queryKey: ['appointments'] })
      await qc.invalidateQueries({ queryKey: ['slots'] })
      await qc.invalidateQueries({ queryKey: ['service-occurrences'] })
    },
    onError: (e) => {
      const msg = userError(e, 'Не удалось создать запись')
      setMessage(null)
      setError(msg)
      toast.error(msg)
    },
  })

  const portfolioItems = portfolioQuery.data?.items ?? []
  const portfolioCategories = useMemo(() => collectPortfolioCategories(portfolioItems), [portfolioItems])
  const filteredPortfolio = useMemo(
    () => filterPortfolioByCategory(portfolioItems, portfolioCategory),
    [portfolioItems, portfolioCategory],
  )

  const reviews = reviewsQuery.data?.items ?? []
  const dist = useMemo(() => ratingDistribution(reviews), [reviews])

  if (masterQuery.isLoading) return <div className="page state-box">Загрузка профиля…</div>
  if (masterQuery.isError) {
    return (
      <main className="page">
        <ErrorBanner error={masterQuery.error} fallbackTitle="Не удалось открыть профиль мастера" />
      </main>
    )
  }
  if (!masterQuery.data) {
    return (
      <main className="page">
        <EmptyState title="Мастер не найден" text="Профиль недоступен или больше не опубликован." />
      </main>
    )
  }

  const { master, services } = masterQuery.data
  const ratingAvg = master.rating_avg ?? 0
  const ratingCount = master.rating_count ?? 0
  const experienceYears = master.experience_years ?? 0

  const summaryStartsAt = isFixed ? selectedOccurrence?.starts_at : slot
  const summaryTz = selectedOccurrence?.timezone || booked?.location_timezone || ''
  const summaryAddress = booked?.location_address
  const confirmStep = isFixed ? 2 : 3
  const canConfirm = isFixed ? Boolean(occurrenceId && selectedOccurrence) : Boolean(slot)

  function scrollToBooking() {
    setBookingFocus(true)
    setStep(0)
    document.getElementById('mp-booking')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (done) {
    return (
      <main className="page stack">
        <div className="empty-state">
          <h2>Запись отправлена</h2>
          <p>{message}</p>
          {selectedService && summaryStartsAt && (
            <p>
              {selectedService.name}
              {' · '}
              {summaryTz
                ? formatDualTime(summaryStartsAt, summaryTz, { withDate: true })
                : new Date(summaryStartsAt).toLocaleString('ru-RU')}
            </p>
          )}
          {(summaryAddress || booked?.location_city) && (
            <p className="muted">
              {[booked?.location_name, booked?.location_city, booked?.location_address].filter(Boolean).join(' · ')}
            </p>
          )}
          <div className="row">
            <Link className="btn btn-primary" to="/appointments">Мои записи</Link>
            <Link className="btn btn-secondary" to="/">На главную</Link>
          </div>
        </div>
      </main>
    )
  }

  const dates = nearbyDates(date)

  return (
    <main className="page mp-page">
      <section className="mp-hero" aria-label="Профиль мастера">
        {master.photo_media_id && (
          <div className="mp-hero-photo" aria-hidden="true">
            <MediaImage mediaId={master.photo_media_id} token={accessToken} alt="" variant="cover" />
          </div>
        )}
        <div className="mp-hero-body">
          <h1>
            {master.display_name}{' '}
            <Hint id="client-booking" title="Запись">
              Выберите услугу и время. Если мастер включил автоподтверждение, запись сразу станет подтверждённой.
            </Hint>
          </h1>
          <div className="mp-hero-tags">
            {(master.profession_types?.length
              ? master.profession_types.map((t) => t.name)
              : [masterProfessionLabel(master, 'Красота и уход')]
            ).map((label) => (
              <span key={label} className="chip badge-default">{label}</span>
            ))}
          </div>
          <div className="mp-hero-meta">
            {ratingCount > 0 && (
              <span>
                <strong>★ {ratingAvg.toFixed(1)}</strong> · {ratingCount}{' '}
                {ratingCount === 1 ? 'отзыв' : 'отзывов'}
              </span>
            )}
            <span className="city-badge">{master.city}</span>
          </div>
          <div className="mp-hero-cta">
            <button className="btn btn-primary" type="button" onClick={scrollToBooking}>
              Записаться
            </button>
            {accessToken && (
              <button
                className="btn btn-secondary mp-msg-btn"
                type="button"
                data-testid="write-master"
                aria-label="Написать"
                onClick={async () => {
                  try {
                    await messenger.start({ type: 'client_master', master_user_id: master.user_id })
                  } catch (e) {
                    setError(userError(e, 'Не удалось открыть переписку'))
                  }
                }}
              >
                ✉
              </button>
            )}
          </div>
          <div className="mp-stats">
            {experienceYears > 0 && (
              <div className="mp-stat">
                <strong>{experienceYears}</strong>
                <span>{experienceYears === 1 ? 'год опыта' : 'лет опыта'}</span>
              </div>
            )}
            {ratingCount > 0 && (
              <div className="mp-stat">
                <strong>{ratingAvg.toFixed(1)}</strong>
                <span>{ratingCount} отзывов</span>
              </div>
            )}
            {services.length > 0 && (
              <div className="mp-stat">
                <strong>{services.length}</strong>
                <span>услуг</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {(master.bio?.trim().length ?? 0) > 0 && (
        <section className={`mp-about ${aboutExpanded ? '' : 'is-collapsed'}`.trim()}>
          <h2 className="mp-section-title">О мастере</h2>
          <p>{master.bio}</p>
          {master.bio.trim().length > 160 && (
            <button
              type="button"
              className="btn-link"
              onClick={() => setAboutExpanded((v) => !v)}
            >
              {aboutExpanded ? 'Свернуть' : 'Подробнее'}
            </button>
          )}
        </section>
      )}

      {portfolioItems.length > 0 && (
        <section className="stack">
          <h2 className="mp-section-title">Портфолио</h2>
          <PortfolioCategoryChips
            categories={portfolioCategories}
            value={portfolioCategory}
            onChange={setPortfolioCategory}
          />
          <PortfolioGrid
            items={filteredPortfolio}
            token={accessToken}
            onOpen={(index) => {
              setViewerIndex(index)
              setViewerOpen(true)
            }}
          />
        </section>
      )}

      <section id="mp-booking" className="card stack">
        <h2 className="mp-section-title">
          Услуги и запись
        </h2>
        <div className="wizard-steps" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
          {steps.map((label, idx) => (
            <div
              key={label}
              className={`wizard-step ${idx === step ? 'active' : ''} ${idx < step ? 'done' : ''}`.trim()}
            >
              {label}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="stack">
            {services.length === 0 && <div className="state-box">Услуги пока не опубликованы</div>}
            {services.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`mp-service-row ${serviceId === s.id ? 'is-selected' : ''}`}
                onClick={() => {
                  setServiceId(s.id)
                  setSlot('')
                  setOccurrenceId('')
                  setError(null)
                }}
              >
                <div className="mp-service-thumb">
                  <MediaImage
                    mediaId={s.photo_media_id}
                    token={accessToken}
                    alt={s.name}
                    fallback={s.name.slice(0, 2).toUpperCase()}
                    variant="cover"
                  />
                </div>
                <div className="mp-service-main">
                  <strong>{s.name}</strong>
                  <span>от {s.duration_minutes} мин</span>
                </div>
                <span className="mp-service-price">
                  {s.price_display || formatMoney(s.price_minor)}
                  <span className="mp-service-chevron" aria-hidden>›</span>
                </span>
              </button>
            ))}
            {selectedService?.description && (
              <p className="muted">{selectedService.description}</p>
            )}
            <button
              className="btn btn-primary"
              type="button"
              disabled={!serviceId}
              onClick={() => setStep(1)}
            >
              Далее
            </button>
            {accessToken && selectedService && canJoinMultiService(selectedService) && master.organization_id && (
              <button
                className="btn btn-secondary"
                type="button"
                data-testid="add-second-service"
                onClick={() => setMultiOpen(true)}
              >
                Добавить вторую услугу
              </button>
            )}
          </div>
        )}

        {!isFixed && step === 1 && (
          <div className="stack">
            <p className="muted">Свободное время</p>
            <div className="mp-date-strip" role="listbox" aria-label="Дата">
              {dates.map((d) => {
                const dt = new Date(`${d}T12:00:00`)
                const weekday = dt.toLocaleDateString('ru-RU', { weekday: 'short' })
                return (
                  <button
                    key={d}
                    type="button"
                    role="option"
                    aria-selected={date === d}
                    className={`mp-date-chip ${date === d ? 'is-active' : ''}`}
                    onClick={() => { setDate(d); setSlot('') }}
                  >
                    <span>{weekday}</span>
                    <strong>{dt.getDate()}</strong>
                  </button>
                )
              })}
            </div>
            <div className="field">
              <label htmlFor="date">Или выберите день</label>
              <input
                id="date"
                type="date"
                value={date}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => { setDate(e.target.value); setSlot('') }}
              />
            </div>
            <div className="row">
              <button className="btn btn-secondary" type="button" onClick={() => setStep(0)}>Назад</button>
              <button className="btn btn-primary" type="button" onClick={() => setStep(2)}>К времени</button>
            </div>
          </div>
        )}

        {!isFixed && step === 2 && (
          <div className="stack">
            {slotsQuery.isLoading && <div className="state-box">Загрузка слотов…</div>}
            {slotsQuery.isError && <ErrorBanner error={slotsQuery.error} fallbackTitle="Не удалось получить свободное время" />}
            {slotsQuery.data && slotsQuery.data.items.length === 0 && (
              <div className="empty-state">
                <h2>Нет свободных окон</h2>
                <p>Выберите другую дату.</p>
              </div>
            )}
            <div className="slot-grid">
              {slotsQuery.data?.items.map((s) => {
                const label = new Date(s.starts_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                return (
                  <button
                    key={s.starts_at}
                    type="button"
                    className={`slot ${slot === s.starts_at ? 'active' : ''}`}
                    onClick={() => setSlot(s.starts_at)}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {(slotsQuery.data?.items.length ?? 0) === 0 && (
              <button type="button" className="slot empty" disabled>—</button>
            )}
            <div className="row">
              <button className="btn btn-secondary" type="button" onClick={() => setStep(1)}>Назад</button>
              <button className="btn btn-primary" type="button" disabled={!slot} onClick={() => setStep(3)}>К подтверждению</button>
            </div>
          </div>
        )}

        {isFixed && step === 1 && (
          <div className="stack">
            {occurrencesQuery.isLoading && <div className="skeleton skeleton-card" />}
            {occurrencesQuery.isError && <ErrorBanner error={occurrencesQuery.error} fallbackTitle="Не удалось загрузить сеансы" />}
            {occurrencesQuery.data && occurrencesQuery.data.items.filter((o) => o.status === 'scheduled' && o.remaining > 0).length === 0 && (
              <div className="empty-state">
                <h2>Нет доступных сеансов</h2>
                <p>Мастер ещё не открыл окна для этой услуги.</p>
              </div>
            )}
            <div className="list">
              {occurrencesQuery.data?.items
                .filter((o) => o.status !== 'cancelled')
                .map((o) => {
                  const disabled = o.status !== 'scheduled' || o.remaining <= 0
                  return (
                    <button
                      key={o.id}
                      type="button"
                      className={`occurrence-card ${occurrenceId === o.id ? 'selected' : ''}`}
                      disabled={disabled}
                      onClick={() => setOccurrenceId(o.id)}
                    >
                      <div className="row between">
                        <strong>{o.title || 'Сеанс'}</strong>
                        <span className="badge badge-default">мест: {o.remaining}</span>
                      </div>
                      <p>{formatRangeInTimezone(o.starts_at, o.ends_at, o.timezone)}</p>
                      <p className="muted">{formatDualTime(o.starts_at, o.timezone)}</p>
                    </button>
                  )
                })}
            </div>
            <div className="row">
              <button className="btn btn-secondary" type="button" onClick={() => setStep(0)}>Назад</button>
              <button className="btn btn-primary" type="button" disabled={!occurrenceId} onClick={() => setStep(2)}>
                К подтверждению
              </button>
            </div>
          </div>
        )}

        {step === confirmStep && selectedService && summaryStartsAt && (
          <div className="stack">
            <article className="booking-summary">
              <h3>Итого</h3>
              <dl>
                <div>
                  <dt>Клиент</dt>
                  <dd>{user?.display_name || user?.email || 'Вы'}</dd>
                </div>
                <div>
                  <dt>Мастер</dt>
                  <dd>{master.display_name}</dd>
                </div>
                <div>
                  <dt>Услуга</dt>
                  <dd>{selectedService.name}</dd>
                </div>
                <div>
                  <dt>Город</dt>
                  <dd>{master.city}</dd>
                </div>
                {summaryAddress && (
                  <div>
                    <dt>Адрес</dt>
                    <dd>{summaryAddress}</dd>
                  </div>
                )}
                <div>
                  <dt>Время</dt>
                  <dd>
                    {summaryTz
                      ? formatDualTime(summaryStartsAt, summaryTz, { withDate: true })
                      : new Date(summaryStartsAt).toLocaleString('ru-RU', {
                          weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
                        })}
                  </dd>
                </div>
                <div>
                  <dt>Длительность</dt>
                  <dd>{selectedService.duration_minutes} мин</dd>
                </div>
                <div>
                  <dt>Цена</dt>
                  <dd>{selectedService.price_display || formatMoney(selectedService.price_minor)}</dd>
                </div>
                <div>
                  <dt>Тип записи</dt>
                  <dd>{bookingModeLabel(selectedService.booking_mode)}</dd>
                </div>
              </dl>
            </article>
            {error && <ErrorBanner error={error} />}
            <div className="row">
              <button className="btn btn-secondary" type="button" onClick={() => setStep(isFixed ? 1 : 2)}>Назад</button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={!canConfirm || book.isPending}
                onClick={() => book.mutate()}
              >
                {book.isPending ? 'Создаём…' : 'Подтвердить запись'}
              </button>
            </div>
          </div>
        )}
      </section>

      {selectedService && master.organization_id && (
        <MultiServiceBookingDialog
          open={multiOpen}
          onClose={() => setMultiOpen(false)}
          token={accessToken}
          organizationId={master.organization_id}
          firstService={selectedService}
          onSuccess={() => {
            setDone(true)
            setMessage('Визит из двух услуг создан')
          }}
        />
      )}

      <section className="stack">
        <h2 className="mp-section-title">Отзывы</h2>
        {ratingCount > 0 && (
          <div className="mp-rating-header">
            <span className="mp-rating-num">{ratingAvg.toFixed(1)}</span>
            <span className="muted">на основе {ratingCount} отзывов</span>
          </div>
        )}
        {reviews.length > 0 && (
          <div className="mp-rating-bars" aria-hidden={reviews.length === 0}>
            {dist.map((count, i) => {
              const star = 5 - i
              const pct = reviews.length ? Math.round((count / reviews.length) * 100) : 0
              return (
                <div key={star} className="mp-rating-bar-row">
                  <span>{star}</span>
                  <div className="mp-rating-bar-track">
                    <div className="mp-rating-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span>{pct}%</span>
                </div>
              )
            })}
          </div>
        )}
        {reviewsQuery.data && reviews.length === 0 && (
          <div className="state-box">Пока нет опубликованных отзывов</div>
        )}
        <div className="list">
          {reviews.map((r) => (
            <article key={r.id} className="list-item">
              <div className="row between">
                <strong>Мастер {r.master_rating}/5</strong>
                <span className="muted">Результат {r.result_rating}/5</span>
              </div>
              {r.comment && <p>{r.comment}</p>}
              <p className="muted">{new Date(r.created_at).toLocaleDateString('ru-RU')}</p>
            </article>
          ))}
        </div>
      </section>

      <PortfolioViewer
        open={viewerOpen}
        items={filteredPortfolio}
        index={viewerIndex}
        token={accessToken}
        onClose={() => setViewerOpen(false)}
        onIndexChange={setViewerIndex}
      />

      <div className="mp-sticky-cta">
        <button className="btn btn-primary" type="button" onClick={scrollToBooking}>
          Записаться
        </button>
      </div>
    </main>
  )
}

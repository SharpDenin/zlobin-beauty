import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { workTypeLabel } from '@/shared/lib/status'
import { formatDualTime, formatRangeInTimezone } from '@/shared/lib/time'
import { MediaImage } from '@/shared/ui/MediaImage'
import { useToast } from '@/shared/ui/Toast'

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
    photo_media_id?: string | null
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
  location_name?: string
  location_city?: string
  location_address?: string
  location_timezone?: string
  booking_mode?: string
}

const FLEX_STEPS = ['Услуга', 'Дата', 'Время', 'Итого'] as const
const FIXED_STEPS = ['Услуга', 'Сеанс', 'Итого'] as const

function bookingModeLabel(mode?: string) {
  return mode === 'fixed_window' ? 'Фиксированное окно' : 'Гибкая запись'
}

export function MasterPage() {
  const { id } = useParams()
  const { accessToken } = useAuth()
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
    enabled: Boolean(masterQuery.data?.master.user_id && selectedService && !isFixed && step >= 2),
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
      apiRequest<{ items: Array<{ id: string; master_rating: number; result_rating: number; comment: string; created_at: string }> }>(
        `/v1/masters/${masterQuery.data!.master.user_id}/reviews`,
      ),
    enabled: Boolean(masterQuery.data?.master.user_id),
  })

  const portfolioQuery = useQuery({
    queryKey: ['master-portfolio', id],
    queryFn: () =>
      apiRequest<{ items: Array<{ id: string; media_id: string; caption: string }> }>(
        `/v1/masters/${id}/portfolio`,
      ),
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
      setMessage('Запись создана и ожидает подтверждения мастера')
      setError(null)
      setBooked(res)
      setDone(true)
      toast.success('Запись отправлена мастеру')
      await qc.invalidateQueries({ queryKey: ['appointments'] })
      await qc.invalidateQueries({ queryKey: ['slots'] })
      await qc.invalidateQueries({ queryKey: ['service-occurrences'] })
    },
    onError: (e) => {
      const msg = e instanceof ApiError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'Не удалось создать запись'
      setMessage(null)
      setError(msg)
      toast.error(msg)
    },
  })

  if (masterQuery.isLoading) return <div className="page state-box">Загрузка профиля…</div>
  if (masterQuery.isError || !masterQuery.data) return <div className="page state-box error">Мастер не найден</div>

  const { master, services } = masterQuery.data
  const initials = master.display_name.slice(0, 1).toUpperCase()

  const summaryStartsAt = isFixed ? selectedOccurrence?.starts_at : slot
  const summaryTz = selectedOccurrence?.timezone || booked?.location_timezone || ''
  const summaryAddress = booked?.location_address
  const confirmStep = isFixed ? 2 : 3
  const canConfirm = isFixed ? Boolean(occurrenceId && selectedOccurrence) : Boolean(slot)

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

  return (
    <main className="page stack">
      <section className="hero">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="avatar-circle">
            {master.photo_media_id ? (
              <MediaImage mediaId={master.photo_media_id} token={accessToken} alt={master.display_name} />
            ) : (
              initials
            )}
          </div>
          <div className="stack-sm" style={{ flex: 1, minWidth: 0 }}>
            <h1>{master.display_name}</h1>
            <div className="row">
              <span className="city-badge">{master.city}</span>
              <span className="chip badge-default">{workTypeLabel(master.work_type)}</span>
            </div>
            <p>{master.specializations.join(', ') || 'Красота и уход'}</p>
            <p>{master.bio || 'Мастер ещё не добавил описание.'}</p>
          </div>
        </div>
      </section>

      {(portfolioQuery.data?.items.length ?? 0) > 0 && (
        <section className="stack">
          <h2>Работы</h2>
          <div className="portfolio-grid">
            {portfolioQuery.data?.items.map((item) => (
              <figure key={item.id} className="portfolio-item">
                <MediaImage mediaId={item.media_id} token={accessToken} alt={item.caption || 'Работа'} className="portfolio-thumb" />
                {item.caption && <figcaption>{item.caption}</figcaption>}
              </figure>
            ))}
          </div>
        </section>
      )}

      <section className="card stack">
        <h2>Запись</h2>
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
          <div className="cards-grid services">
            {services.length === 0 && <div className="state-box">Услуги пока не опубликованы</div>}
            {services.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`service-card ${serviceId === s.id ? 'selected' : ''}`}
                onClick={() => {
                  setServiceId(s.id)
                  setSlot('')
                  setOccurrenceId('')
                  setError(null)
                }}
              >
                <div className="row between">
                  <strong>{s.name}</strong>
                  <span>{s.price_display || formatMoney(s.price_minor)}</span>
                </div>
                <p>{s.category} · {s.duration_minutes} мин</p>
                <p className="muted">{bookingModeLabel(s.booking_mode)}</p>
                {s.description && <p className="muted">{s.description}</p>}
              </button>
            ))}
            <button
              className="btn btn-primary"
              type="button"
              disabled={!serviceId}
              onClick={() => setStep(1)}
            >
              Далее
            </button>
          </div>
        )}

        {!isFixed && step === 1 && (
          <div className="stack">
            <div className="field">
              <label htmlFor="date">Выберите день</label>
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
            {slotsQuery.isError && <div className="state-box error">Не удалось получить свободное время</div>}
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
            {occurrencesQuery.isError && <div className="state-box error">Не удалось загрузить сеансы</div>}
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
            {error && <div className="state-box error">{error}</div>}
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

      <section className="stack">
        <h2>Отзывы</h2>
        {reviewsQuery.data && reviewsQuery.data.items.length === 0 && (
          <div className="state-box">Пока нет опубликованных отзывов</div>
        )}
        <div className="list">
          {reviewsQuery.data?.items.map((r) => (
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
    </main>
  )
}

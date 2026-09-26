import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { apiRequest } from '@/shared/api/client'
import { userError, formatUserError } from '@/shared/lib/app-error'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { useAuth } from '@/features/auth/AuthProvider'
import { useMessenger } from '@/features/messenger/MessengerProvider'

type Masterclass = {
  id: string
  title: string
  description: string
  category: string
  city: string
  location_note: string
  starts_at: string
  ends_at: string
  instructor_user_id: string
  instructor_name: string
  capacity: number
  registered_count: number
  available_seats: number
  status: string
  relevant?: boolean
}

type Interest = {
  id: string
  category: string
  city: string
  date_from: string
  date_to: string
}

type Registration = {
  id: string
  master_user_id: string
  status: string
}

function statusLabel(status: string) {
  switch (status) {
    case 'draft':
      return 'Черновик'
    case 'published':
      return 'Опубликован'
    case 'closed':
      return 'Закрыт'
    case 'cancelled':
      return 'Отменён'
    case 'confirmed':
      return 'Подтверждена'
    default:
      return status
  }
}

export function MasterclassListPage() {
  const { accessToken } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const published = useQuery({
    queryKey: ['masterclasses'],
    queryFn: () => apiRequest<{ items: Masterclass[] }>('/v1/masterclasses', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const mine = useQuery({
    queryKey: ['masterclasses-mine'],
    queryFn: () => apiRequest<{ items: Masterclass[] }>('/v1/masterclasses?mine=1', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const interests = useQuery({
    queryKey: ['masterclass-interests'],
    queryFn: () => apiRequest<{ items: Interest[] }>('/v1/masterclass-interests', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const qc = useQueryClient()
  const [category, setCategory] = useState('Колористика')
  const [city, setCity] = useState('Красноярск')
  const [dateFrom, setDateFrom] = useState('2026-09-15')
  const [dateTo, setDateTo] = useState('2026-09-15')

  const addInterest = useMutation({
    mutationFn: () =>
      apiRequest('/v1/masterclass-interests', {
        method: 'POST',
        token: accessToken,
        body: { category, city, date_from: dateFrom, date_to: dateTo },
      }),
    onSuccess: () => {
      setError(null)
      void qc.invalidateQueries({ queryKey: ['masterclass-interests'] })
      void qc.invalidateQueries({ queryKey: ['masterclasses'] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось сохранить интерес')),
  })

  return (
    <main className="page stack">
      <div className="row between">
        <h1>Мастер-классы</h1>
        <Link className="btn btn-primary" to="/masterclasses/new">Готов провести мастер-класс</Link>
      </div>
      {error && <ErrorBanner error={error} />}

      <section className="card stack">
        <h2>Хочу мастер-класс</h2>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            addInterest.mutate()
          }}
        >
          <div className="field">
            <label htmlFor="mc-interest-category">Тема</label>
            <input id="mc-interest-category" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="mc-interest-city">Город</label>
            <input id="mc-interest-city" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="mc-interest-from">С даты</label>
            <input id="mc-interest-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="mc-interest-to">По дату</label>
            <input id="mc-interest-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <button className="btn btn-secondary" type="submit" disabled={addInterest.isPending}>Сохранить интерес</button>
        </form>
        {(interests.data?.items.length ?? 0) > 0 && (
          <div className="list">
            {interests.data?.items.map((i) => (
              <article key={i.id} className="list-item">
                <strong>{i.category}</strong>
                <p className="muted">{i.city} · {i.date_from} — {i.date_to}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="stack">
        <h2>Афиша</h2>
        {published.isLoading && <div className="state-box">Загрузка…</div>}
        {(published.data?.items.length ?? 0) === 0 && !published.isLoading && (
          <div className="empty-state"><h2>Пока нет опубликованных мастер-классов</h2></div>
        )}
        <div className="cards-grid">
          {published.data?.items.map((e) => (
            <Link key={e.id} className="card stack-sm" to={`/masterclasses/${e.id}`} data-testid={`masterclass-${e.id}`}>
              <div className="row between">
                <strong>{e.title}</strong>
                {e.relevant && <span className="badge badge-success">Подходит вам</span>}
              </div>
              <p>{e.instructor_name} · {e.city}</p>
              <p className="muted">{new Date(e.starts_at).toLocaleString('ru-RU')} · мест {e.available_seats}</p>
            </Link>
          ))}
        </div>
      </section>

      {(mine.data?.items.length ?? 0) > 0 && (
        <section className="stack">
          <h2>Мои мастер-классы</h2>
          <div className="list">
            {mine.data?.items.map((e) => (
              <Link key={e.id} className="list-item" to={`/masterclasses/${e.id}`}>
                <div className="row between">
                  <strong>{e.title}</strong>
                  <span className="chip badge-default">{statusLabel(e.status)}</span>
                </div>
                <p className="muted">{e.city} · {new Date(e.starts_at).toLocaleString('ru-RU')}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}

export function MasterclassCreatePage() {
  const { accessToken } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('Колористика / сложное окрашивание')
  const [category, setCategory] = useState('Колористика')
  const [description, setDescription] = useState('Практический разбор сложного окрашивания')
  const [city, setCity] = useState('Красноярск')
  const [location, setLocation] = useState('Салон')
  const [starts, setStarts] = useState('2026-09-15T10:00')
  const [ends, setEnds] = useState('2026-09-15T14:00')
  const [capacity, setCapacity] = useState('8')

  const save = useMutation({
    mutationFn: async () => {
      const created = await apiRequest<Masterclass>('/v1/masterclasses', {
        method: 'POST',
        token: accessToken,
        body: {
          title, category, description, city, location_note: location, capacity: Number(capacity),
          starts_at: new Date(starts).toISOString(), ends_at: new Date(ends).toISOString(),
          timezone: 'Asia/Krasnoyarsk',
        },
      })
      return apiRequest<Masterclass>(`/v1/masterclasses/${created.id}/publish`, { method: 'POST', token: accessToken })
    },
    onSuccess: (e) => navigate(`/masterclasses/${e.id}`),
    onError: (e) => setError(formatUserError(e, 'Не удалось опубликовать')),
  })

  return (
    <main className="page stack">
      <Link className="btn btn-ghost btn-compact" to="/masterclasses">← К афише</Link>
      <h1>Готов провести мастер-класс</h1>
      {error && <ErrorBanner error={error} />}
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <div className="field"><label htmlFor="mc-title">Название</label><input id="mc-title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="field"><label htmlFor="mc-cat">Тема / услуга</label><input id="mc-cat" value={category} onChange={(e) => setCategory(e.target.value)} /></div>
        <div className="field"><label htmlFor="mc-desc">Описание</label><textarea id="mc-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="field"><label htmlFor="mc-city">Город</label><input id="mc-city" value={city} onChange={(e) => setCity(e.target.value)} /></div>
        <div className="field"><label htmlFor="mc-loc">Площадка</label><input id="mc-loc" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
        <div className="field"><label htmlFor="mc-start">Начало</label><input id="mc-start" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} /></div>
        <div className="field"><label htmlFor="mc-end">Окончание</label><input id="mc-end" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} /></div>
        <div className="field"><label htmlFor="mc-cap">Вместимость</label><input id="mc-cap" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
        <button className="btn btn-primary" type="submit" disabled={save.isPending}>Опубликовать</button>
      </form>
    </main>
  )
}

export function MasterclassDetailPage() {
  const { id } = useParams()
  const { accessToken, user } = useAuth()
  const messenger = useMessenger()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const event = useQuery({
    queryKey: ['masterclass', id],
    queryFn: () => apiRequest<Masterclass>(`/v1/masterclasses/${id}`, { token: accessToken }),
    enabled: Boolean(accessToken && id),
  })
  const regs = useQuery({
    queryKey: ['masterclass-regs', id],
    queryFn: () => apiRequest<{ items: Registration[] }>(`/v1/masterclasses/${id}/registrations`, { token: accessToken }),
    enabled: Boolean(accessToken && id && event.data?.instructor_user_id === user?.id),
  })
  const matches = useQuery({
    queryKey: ['masterclass-matches', id],
    queryFn: () => apiRequest<{ items: Array<{ id: string; category: string; city: string; master_user_id: string; date_from: string; date_to: string }> }>(`/v1/masterclasses/${id}/matches`, { token: accessToken }),
    enabled: Boolean(accessToken && id && event.data?.instructor_user_id === user?.id),
  })

  const register = useMutation({
    mutationFn: () => apiRequest(`/v1/masterclasses/${id}/register`, { method: 'POST', token: accessToken }),
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['masterclass', id] }) },
    onError: (e) => setError(formatUserError(e, 'Не удалось записаться')),
  })

  const e = event.data
  const mine = Boolean(e && user?.id && (regs.data?.items ?? []).some((r) => r.master_user_id === user.id && r.status !== 'cancelled'))
  const isInstructor = e?.instructor_user_id === user?.id

  return (
    <main className="page stack">
      <Link className="btn btn-ghost btn-compact" to="/masterclasses">← Афиша</Link>
      {event.isLoading && <div className="state-box">Загрузка…</div>}
      {event.isError && <ErrorBanner error={event.error} fallbackTitle="Мероприятие недоступно" />}
      {error && <ErrorBanner error={error} />}
      {e && (
        <section className="card stack">
          <div className="row between">
            <h1>{e.title}</h1>
            {e.relevant && <span className="badge badge-success">Подходит вам</span>}
          </div>
          <p>{e.instructor_name} · {e.city}</p>
          <p className="muted">{new Date(e.starts_at).toLocaleString('ru-RU')} — {new Date(e.ends_at).toLocaleString('ru-RU')}</p>
          <p>{e.description}</p>
          <p>Свободных мест: {e.available_seats} из {e.capacity}</p>
          <p className="muted">{statusLabel(e.status)}</p>
          {!isInstructor && (
            <div className="row">
              <button className="btn btn-primary" type="button" data-testid="register-masterclass" disabled={register.isPending || e.available_seats <= 0} onClick={() => register.mutate()}>
                {mine ? 'Вы записаны' : 'Записаться'}
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                data-testid="message-instructor"
                onClick={async () => {
                  try {
                    await messenger.start({
                      type: 'masterclass', event_id: e.id, peer_user_id: e.instructor_user_id,
                    })
                  } catch (err) {
                    setError(userError(err, 'Сначала запишитесь, чтобы написать инструктору'))
                  }
                }}
              >
                Написать инструктору
              </button>
            </div>
          )}
        </section>
      )}
      {isInstructor && (
        <>
          <section className="card stack">
            <h2>Заинтересованные мастера</h2>
            {(matches.data?.items.length ?? 0) === 0 && <p className="muted">Пока нет совпадений по теме, городу и датам.</p>}
            <div className="list">
              {matches.data?.items.map((m) => (
                <article key={m.id} className="list-item" data-testid="interested-master">
                  <strong>{m.category}</strong>
                  <p className="muted">{m.city} · {m.date_from} — {m.date_to}</p>
                </article>
              ))}
            </div>
          </section>
          <section className="card stack">
            <h2>Записи</h2>
            {(regs.data?.items.length ?? 0) === 0 && <p className="muted">Пока никто не записался.</p>}
            <div className="list">
              {regs.data?.items.map((r) => (
                <article key={r.id} className="list-item" data-testid="masterclass-registration">
                  <strong>{statusLabel(r.status)}</strong>
                  <p className="muted">Участник</p>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  )
}

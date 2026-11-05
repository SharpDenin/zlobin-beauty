import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { userError, formatUserError } from '@/shared/lib/app-error'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { useMessenger } from '@/features/messenger/MessengerProvider'

type Prefs = {
  notify: boolean
  categories: string[]
  city: string
  date_from: string | null
  date_to: string | null
}

type ModelRequest = {
  id: string
  title: string
  description: string
  category: string
  city: string
  location_note: string
  starts_at: string
  ends_at: string
  master_user_id: string
  master_name: string
  capacity: number
  accepted_count: number
  available_slots: number
  status: string
  relevant?: boolean
  interested?: boolean
  my_response?: { id: string; status: string } | null
}

type InterestRow = {
  request_id: string
  title: string
  starts_at: string
  ends_at: string
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
    case 'requested':
      return 'Отклик отправлен'
    case 'accepted':
      return 'Слот подтверждён'
    default:
      return status
  }
}

function formatRange(starts: string, ends: string) {
  const a = new Date(starts)
  const b = new Date(ends)
  return `${a.toLocaleString('ru-RU')} — ${b.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
}

export function ModelsPage() {
  const { accessToken } = useAuth()
  const cabinet = useCabinet()
  const isMaster = cabinet.kind !== 'client' && cabinet.kind !== 'supplier' && cabinet.kind !== 'supplier_rep'
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [notify, setNotify] = useState(false)
  const [categories, setCategories] = useState('Колористика')
  const [city, setCity] = useState('Красноярск')
  const [dateFrom, setDateFrom] = useState('2026-09-15')
  const [dateTo, setDateTo] = useState('2026-09-15')

  const prefs = useQuery({
    queryKey: ['model-prefs'],
    queryFn: async () => {
      const p = await apiRequest<Prefs>('/v1/me/model-preferences', { token: accessToken })
      setNotify(p.notify)
      setCategories((p.categories ?? []).join(', ') || 'Колористика')
      setCity(p.city || 'Красноярск')
      setDateFrom(p.date_from || '2026-09-15')
      setDateTo(p.date_to || '2026-09-15')
      return p
    },
    enabled: Boolean(accessToken) && !isMaster,
  })

  const requests = useQuery({
    queryKey: ['model-requests', isMaster],
    queryFn: () => apiRequest<{ items: ModelRequest[] }>(isMaster ? '/v1/model-requests?mine=1' : '/v1/model-requests', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const interests = useQuery({
    queryKey: ['model-request-interests'],
    queryFn: () => apiRequest<{ items: InterestRow[] }>('/v1/model-requests/interests', { token: accessToken }),
    enabled: Boolean(accessToken) && !isMaster,
  })

  const savePrefs = useMutation({
    mutationFn: () =>
      apiRequest('/v1/me/model-preferences', {
        method: 'PATCH',
        token: accessToken,
        body: {
          notify,
          categories: categories.split(',').map((s) => s.trim()).filter(Boolean),
          city, date_from: dateFrom, date_to: dateTo,
        },
      }),
    onSuccess: () => { setOk('Настройки уведомлений сохранены'); setError(null); void qc.invalidateQueries({ queryKey: ['model-prefs'] }) },
    onError: (e) => { setOk(null); setError(formatUserError(e, 'Не удалось сохранить')) },
  })

  const addInterest = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/v1/model-requests/${id}/interest`, { method: 'POST', token: accessToken }),
    onSuccess: () => {
      setError(null)
      setOk('Добавлено в интересующие')
      void qc.invalidateQueries({ queryKey: ['model-requests'] })
      void qc.invalidateQueries({ queryKey: ['model-request-interests'] })
    },
    onError: (e) => {
      setOk(null)
      if (e instanceof ApiError && e.code === 'model_interest_overlap') {
        setError(formatUserError(e, 'Это предложение пересекается по времени с уже выбранным'))
        return
      }
      setError(formatUserError(e, 'Не удалось добавить интерес'))
    },
  })

  const removeInterest = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/v1/model-requests/${id}/interest`, { method: 'DELETE', token: accessToken }),
    onSuccess: () => {
      setError(null)
      setOk('Интерес снят')
      void qc.invalidateQueries({ queryKey: ['model-requests'] })
      void qc.invalidateQueries({ queryKey: ['model-request-interests'] })
    },
    onError: (e) => { setOk(null); setError(formatUserError(e, 'Не удалось снять интерес')) },
  })

  const selectedIds = useMemo(
    () => new Set((interests.data?.items ?? []).map((i) => i.request_id)),
    [interests.data],
  )

  return (
    <main className="page stack">
      <div className="row between wrap">
        <h1>{isMaster ? 'Требуются модели' : 'Модели'}</h1>
        {isMaster && <Link className="btn btn-primary" to="/models/new">Нужна модель</Link>}
      </div>
      {error && <ErrorBanner error={error} />}
      {ok && <div className="state-box success" role="status">{ok}</div>}

      {!isMaster && (
        <>
          <section className="card stack">
            <h2>Уведомления о подходящих предложениях</h2>
            <p className="muted">Выберите конкретные мероприятия ниже. Эти настройки только помогают подсвечивать и уведомлять о новых предложениях.</p>
            {prefs.isLoading && <div className="state-box">Загрузка…</div>}
            <label className="row">
              <input data-testid="model-notify" type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              Получать предложения
            </label>
            <div className="field">
              <label htmlFor="model-cats">Интересующие услуги</label>
              <input id="model-cats" data-testid="model-categories" value={categories} onChange={(e) => setCategories(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="model-city">Город</label>
              <input id="model-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="model-from">С даты</label>
              <input id="model-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="model-to">По дату</label>
              <input id="model-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <button className="btn btn-secondary" type="button" data-testid="save-model-prefs" disabled={savePrefs.isPending} onClick={() => savePrefs.mutate()}>
              Сохранить уведомления
            </button>
          </section>

          <section className="card stack" data-testid="model-selected-interests">
            <h2>Выбранные предложения</h2>
            {(interests.data?.items.length ?? 0) === 0 && (
              <p className="muted">Пока ничего не выбрано. Отметьте предложения в афише — нельзя выбрать пересекающиеся по времени.</p>
            )}
            <div className="list">
              {(interests.data?.items ?? []).map((i) => (
                <article key={i.request_id} className="list-item stack-sm">
                  <div className="row between wrap">
                    <strong>{i.title}</strong>
                    <button
                      className="btn btn-secondary btn-compact"
                      type="button"
                      disabled={removeInterest.isPending}
                      onClick={() => removeInterest.mutate(i.request_id)}
                    >
                      Убрать
                    </button>
                  </div>
                  <p className="muted">{formatRange(i.starts_at, i.ends_at)}</p>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      <section className="stack">
        <h2>{isMaster ? 'Мои запросы' : 'Предложения'}</h2>
        {requests.isLoading && <div className="state-box">Загрузка…</div>}
        {(requests.data?.items.length ?? 0) === 0 && !requests.isLoading && (
          <div className="empty-state"><h2>Пока нет запросов</h2></div>
        )}
        <div className="cards-grid">
          {requests.data?.items.map((item) => {
            const interested = item.interested || selectedIds.has(item.id)
            return (
              <article
                key={item.id}
                className={`card stack-sm${interested ? ' is-selected' : ''}`}
                data-testid={`model-request-${item.id}`}
                data-interested={interested ? '1' : '0'}
              >
                <div className="row between wrap">
                  <Link to={`/models/${item.id}`}><strong>{item.title}</strong></Link>
                  {interested && <span className="badge badge-confirmed">Интересует</span>}
                  {!interested && item.relevant && <span className="badge badge-success">Подходит вам</span>}
                </div>
                <p>{item.master_name || item.category} · {item.city}</p>
                <p className="muted">{formatRange(item.starts_at, item.ends_at)} · слотов {item.available_slots}</p>
                <p className="muted">{statusLabel(item.status)}</p>
                {!isMaster && item.status === 'published' && (
                  <div className="row wrap">
                    {interested ? (
                      <button
                        className="btn btn-secondary btn-compact"
                        type="button"
                        data-testid={`uninterest-${item.id}`}
                        disabled={removeInterest.isPending}
                        onClick={() => removeInterest.mutate(item.id)}
                      >
                        Не интересует
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary btn-compact"
                        type="button"
                        data-testid={`interest-${item.id}`}
                        disabled={addInterest.isPending}
                        onClick={() => addInterest.mutate(item.id)}
                      >
                        Интересует
                      </button>
                    )}
                    <Link className="btn btn-secondary btn-compact" to={`/models/${item.id}`}>Открыть · отклик</Link>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </section>
    </main>
  )
}

export function ModelRequestCreatePage() {
  const { accessToken } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('Требуется модель на окрашивание')
  const [category, setCategory] = useState('Колористика')
  const [description, setDescription] = useState('Съёмка сложного окрашивания, нужен опыт в роли модели')
  const [city, setCity] = useState('Красноярск')
  const [location, setLocation] = useState('Салон')
  const [starts, setStarts] = useState('2026-09-15T11:00')
  const [ends, setEnds] = useState('2026-09-15T13:00')
  const [capacity, setCapacity] = useState('1')

  const save = useMutation({
    mutationFn: async () => {
      const created = await apiRequest<ModelRequest>('/v1/model-requests', {
        method: 'POST',
        token: accessToken,
        body: {
          title, category, description, city, location_note: location, capacity: Number(capacity),
          starts_at: new Date(starts).toISOString(), ends_at: new Date(ends).toISOString(),
          timezone: 'Asia/Krasnoyarsk',
        },
      })
      return apiRequest<ModelRequest>(`/v1/model-requests/${created.id}/publish`, { method: 'POST', token: accessToken })
    },
    onSuccess: (e) => navigate(`/models/${e.id}`),
    onError: (e) => setError(formatUserError(e, 'Не удалось опубликовать')),
  })

  return (
    <main className="page stack">
      <Link className="btn btn-ghost btn-compact" to="/models">← К запросам</Link>
      <h1>Нужна модель</h1>
      {error && <ErrorBanner error={error} />}
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <div className="field"><label htmlFor="mr-title">Название</label><input id="mr-title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="field"><label htmlFor="mr-cat">Услуга / категория</label><input id="mr-cat" value={category} onChange={(e) => setCategory(e.target.value)} /></div>
        <div className="field"><label htmlFor="mr-desc">Описание</label><textarea id="mr-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="field"><label htmlFor="mr-city">Город</label><input id="mr-city" value={city} onChange={(e) => setCity(e.target.value)} /></div>
        <div className="field"><label htmlFor="mr-loc">Площадка</label><input id="mr-loc" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
        <div className="field"><label htmlFor="mr-start">Начало</label><input id="mr-start" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} /></div>
        <div className="field"><label htmlFor="mr-end">Окончание</label><input id="mr-end" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} /></div>
        <div className="field"><label htmlFor="mr-cap">Сколько моделей</label><input id="mr-cap" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
        <button className="btn btn-primary" type="submit" disabled={save.isPending}>Опубликовать</button>
      </form>
    </main>
  )
}

export function ModelRequestDetailPage() {
  const { id } = useParams()
  const { accessToken, user } = useAuth()
  const messenger = useMessenger()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const item = useQuery({
    queryKey: ['model-request', id],
    queryFn: () => apiRequest<ModelRequest>(`/v1/model-requests/${id}`, { token: accessToken }),
    enabled: Boolean(accessToken && id),
  })

  const addInterest = useMutation({
    mutationFn: () => apiRequest(`/v1/model-requests/${id}/interest`, { method: 'POST', token: accessToken }),
    onSuccess: () => {
      setError(null)
      void qc.invalidateQueries({ queryKey: ['model-request', id] })
      void qc.invalidateQueries({ queryKey: ['model-request-interests'] })
      void qc.invalidateQueries({ queryKey: ['model-requests'] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось добавить интерес')),
  })
  const removeInterest = useMutation({
    mutationFn: () => apiRequest(`/v1/model-requests/${id}/interest`, { method: 'DELETE', token: accessToken }),
    onSuccess: () => {
      setError(null)
      void qc.invalidateQueries({ queryKey: ['model-request', id] })
      void qc.invalidateQueries({ queryKey: ['model-request-interests'] })
      void qc.invalidateQueries({ queryKey: ['model-requests'] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось снять интерес')),
  })
  const respond = useMutation({
    mutationFn: () => apiRequest(`/v1/model-requests/${id}/respond`, { method: 'POST', token: accessToken }),
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['model-request', id] }) },
    onError: (e) => setError(formatUserError(e, 'Не удалось откликнуться')),
  })
  const accept = useMutation({
    mutationFn: () => apiRequest(`/v1/model-responses/${item.data?.my_response?.id}/accept`, { method: 'POST', token: accessToken }),
    onSuccess: () => {
      setError(null)
      void qc.invalidateQueries({ queryKey: ['model-request', id] })
      void qc.invalidateQueries({ queryKey: ['model-request-interests'] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось записаться')),
  })

  const e = item.data
  const isMaster = e?.master_user_id === user?.id
  const responded = Boolean(e?.my_response && e.my_response.status !== 'cancelled')
  const interested = Boolean(e?.interested)

  return (
    <main className="page stack">
      <Link className="btn btn-ghost btn-compact" to="/models">← К запросам</Link>
      {item.isLoading && <div className="state-box">Загрузка…</div>}
      {item.isError && <ErrorBanner error={item.error} fallbackTitle="Запрос недоступен" />}
      {error && <ErrorBanner error={error} />}
      {e && (
        <section className="card stack">
          <h1>{e.title}</h1>
          <p>{e.master_name} · {e.city}</p>
          <p className="muted">{formatRange(e.starts_at, e.ends_at)}</p>
          <p>{e.description}</p>
          <p>Свободных слотов: {e.available_slots} из {e.capacity}</p>
          {e.my_response && <p>Статус отклика: {statusLabel(e.my_response.status)}</p>}
          {interested && <p className="badge badge-confirmed">В интересующих</p>}
          {!isMaster && (
            <div className="row wrap">
              {e.status === 'published' && !interested && (
                <button className="btn btn-secondary" type="button" data-testid="interest-model" disabled={addInterest.isPending} onClick={() => addInterest.mutate()}>
                  Интересует
                </button>
              )}
              {interested && (
                <button className="btn btn-secondary" type="button" data-testid="uninterest-model" disabled={removeInterest.isPending} onClick={() => removeInterest.mutate()}>
                  Не интересует
                </button>
              )}
              <button className="btn btn-secondary" type="button" data-testid="respond-model" disabled={respond.isPending || responded} onClick={() => respond.mutate()}>
                Откликнуться
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                data-testid="message-model-master"
                onClick={async () => {
                  try {
                    await messenger.start({
                      type: 'model_request', request_id: e.id, peer_user_id: e.master_user_id,
                    })
                  } catch (err) {
                    setError(userError(err, 'Сначала откликнитесь, чтобы написать мастеру'))
                  }
                }}
              >
                Связаться с мастером
              </button>
              <button
                className="btn btn-primary"
                type="button"
                data-testid="accept-model"
                disabled={!responded || e.my_response?.status === 'accepted' || accept.isPending}
                onClick={() => accept.mutate()}
              >
                Записаться
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  )
}

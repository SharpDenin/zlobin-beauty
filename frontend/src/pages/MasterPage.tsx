import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'

type Service = {
  id: string
  name: string
  category: string
  duration_minutes: number
  price_minor: number
  price_display: string
}

type MasterDetails = {
  master: {
    id: string
    user_id: string
    display_name: string
    bio: string
    city: string
    specializations: string[]
  }
  services: Service[]
}

type Slot = { starts_at: string; ends_at: string }

function formatMoney(minor: number) {
  return `${Math.round(minor / 100)} ₽`
}

export function MasterPage() {
  const { id } = useParams()
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [serviceId, setServiceId] = useState<string>('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [slot, setSlot] = useState<string>('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const masterQuery = useQuery({
    queryKey: ['master', id],
    queryFn: () => apiRequest<MasterDetails>(`/v1/masters/${id}`),
    enabled: Boolean(id),
  })

  const selectedService = useMemo(
    () => masterQuery.data?.services.find((s) => s.id === serviceId),
    [masterQuery.data, serviceId],
  )

  const slotsQuery = useQuery({
    queryKey: ['slots', masterQuery.data?.master.user_id, date, selectedService?.duration_minutes],
    queryFn: () =>
      apiRequest<{ items: Slot[] }>(
        `/v1/masters/${masterQuery.data!.master.user_id}/slots?date=${date}&duration_minutes=${selectedService!.duration_minutes}`,
      ),
    enabled: Boolean(masterQuery.data?.master.user_id && selectedService),
  })

  const book = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new ApiError('Требуется вход', 'unauthorized', 401)
      return apiRequest('/v1/appointments', {
        token: accessToken,
        body: {
          master_id: id,
          service_id: serviceId,
          starts_at: slot,
        },
      })
    },
    onSuccess: async () => {
      setMessage('Запись создана и ожидает подтверждения мастера')
      setError(null)
      setSlot('')
      await qc.invalidateQueries({ queryKey: ['appointments'] })
      await qc.invalidateQueries({ queryKey: ['slots'] })
    },
    onError: (e) => {
      setMessage(null)
      setError(e instanceof ApiError ? e.message : 'Не удалось создать запись')
    },
  })

  if (masterQuery.isLoading) return <div className="page state-box">Загрузка профиля…</div>
  if (masterQuery.isError || !masterQuery.data) return <div className="page state-box error">Мастер не найден</div>

  const { master, services } = masterQuery.data

  return (
    <main className="page stack">
      <section className="card stack">
        <div className="row between">
          <h1>{master.display_name}</h1>
          <span className="badge badge-default">{master.city}</span>
        </div>
        <p>{master.specializations.join(', ')}</p>
        <p>{master.bio || 'Мастер ещё не добавил описание.'}</p>
      </section>

      <section className="card stack">
        <h2>Услуги</h2>
        {services.length === 0 && <div className="state-box">Услуги пока не опубликованы</div>}
        <div className="list">
          {services.map((s) => (
            <button
              key={s.id}
              type="button"
              className="list-item"
              onClick={() => { setServiceId(s.id); setSlot('') }}
              style={{ textAlign: 'left', borderColor: serviceId === s.id ? 'var(--color-primary)' : undefined }}
            >
              <div className="row between">
                <strong>{s.name}</strong>
                <span>{s.price_display || formatMoney(s.price_minor)}</span>
              </div>
              <p>{s.category} · {s.duration_minutes} мин</p>
            </button>
          ))}
        </div>
      </section>

      {selectedService && (
        <section className="card stack">
          <h2>Дата и время</h2>
          <div className="field">
            <label htmlFor="date">Дата</label>
            <input id="date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setSlot('') }} />
          </div>
          {slotsQuery.isLoading && <div className="state-box">Загрузка слотов…</div>}
          {slotsQuery.isError && <div className="state-box error">Не удалось получить свободное время</div>}
          {slotsQuery.data && slotsQuery.data.items.length === 0 && (
            <div className="state-box">На эту дату нет свободных слотов</div>
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
          {message && <div className="state-box" style={{ color: 'var(--color-success)' }}>{message}</div>}
          {error && <div className="state-box error">{error}</div>}
          <button
            className="btn btn-primary btn-block"
            type="button"
            disabled={!slot || book.isPending}
            onClick={() => book.mutate()}
          >
            {book.isPending ? 'Создаём запись…' : `Записаться · ${formatMoney(selectedService.price_minor)}`}
          </button>
        </section>
      )}
    </main>
  )
}

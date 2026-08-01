import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useState } from 'react'

type Appointment = {
  id: string
  service_name: string
  status: string
  starts_at: string
  ends_at: string
  price_minor: number
  master_user_id: string
  client_user_id: string
}

function statusBadge(status: string) {
  if (status === 'confirmed') return 'badge-confirmed'
  if (status === 'pending_confirmation') return 'badge-pending'
  return 'badge-default'
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    pending_confirmation: 'Ожидает подтверждения',
    confirmed: 'Подтверждена',
    in_progress: 'В процессе',
    completed: 'Завершена',
    cancelled_by_client: 'Отменена клиентом',
    cancelled_by_master: 'Отменена мастером',
    cancelled_by_salon: 'Отменена салоном',
    no_show: 'Клиент не пришёл',
  }
  return map[status] ?? status
}

export function AppointmentsPage() {
  const { accessToken, user } = useAuth()
  const isMaster = user?.roles.includes('master')
  const [role, setRole] = useState<'client' | 'master'>(isMaster ? 'master' : 'client')
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['appointments', role],
    queryFn: () =>
      apiRequest<{ items: Appointment[] }>(`/v1/appointments/mine?role=${role}`, { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const confirm = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/v1/appointments/${id}/confirm`, { method: 'POST', token: accessToken }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['appointments'] })
    },
  })

  return (
    <main className="page stack">
      <div className="row between">
        <h1>Записи</h1>
        {isMaster && (
          <div className="row">
            <button className={`btn ${role === 'client' ? 'btn-primary' : 'btn-secondary'}`} type="button" onClick={() => setRole('client')}>Как клиент</button>
            <button className={`btn ${role === 'master' ? 'btn-primary' : 'btn-secondary'}`} type="button" onClick={() => setRole('master')}>Как мастер</button>
          </div>
        )}
      </div>

      {query.isLoading && <div className="state-box">Загрузка записей…</div>}
      {query.isError && <div className="state-box error">Не удалось загрузить записи</div>}
      {query.data && query.data.items.length === 0 && <div className="state-box">Записей пока нет</div>}

      <div className="list">
        {query.data?.items.map((a) => (
          <article key={a.id} className="list-item">
            <div className="row between">
              <strong>{a.service_name}</strong>
              <span className={`badge ${statusBadge(a.status)}`}>{statusLabel(a.status)}</span>
            </div>
            <p>
              {new Date(a.starts_at).toLocaleString('ru-RU')} · {Math.round(a.price_minor / 100)} ₽
            </p>
            {role === 'master' && a.status === 'pending_confirmation' && (
              <button
                className="btn btn-primary"
                type="button"
                disabled={confirm.isPending}
                onClick={() => confirm.mutate(a.id, {
                  onError: (e) => alert(e instanceof ApiError ? e.message : 'Ошибка подтверждения'),
                })}
              >
                Подтвердить
              </button>
            )}
          </article>
        ))}
      </div>
    </main>
  )
}

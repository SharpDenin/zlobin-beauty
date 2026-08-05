import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { apiRequest, ApiError } from '@/shared/api/client'
import { hasMasterAccess, useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { statusBadgeClass, statusLabel } from '@/shared/lib/status'

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

export function AppointmentsPage() {
  const { accessToken, user } = useAuth()
  const canMaster = hasMasterAccess(user)
  const [role, setRole] = useState<'client' | 'master'>(canMaster ? 'master' : 'client')
  const [actionError, setActionError] = useState<string | null>(null)
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
      setActionError(null)
      await qc.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: (e) => setActionError(e instanceof ApiError ? e.message : 'Не удалось подтвердить'),
  })

  return (
    <main className="page stack">
      <div className="row between">
        <h1>Записи</h1>
        {canMaster && (
          <div className="row">
            <button className={`btn btn-compact ${role === 'client' ? 'btn-primary' : 'btn-secondary'}`} type="button" onClick={() => setRole('client')}>Клиент</button>
            <button className={`btn btn-compact ${role === 'master' ? 'btn-primary' : 'btn-secondary'}`} type="button" onClick={() => setRole('master')}>Мастер</button>
          </div>
        )}
      </div>

      {actionError && <div className="state-box error">{actionError}</div>}
      {query.isLoading && <div className="state-box">Загрузка записей…</div>}
      {query.isError && <div className="state-box error">Не удалось загрузить записи</div>}
      {query.data && query.data.items.length === 0 && (
        <div className="state-box">
          Записей пока нет.
          {role === 'client' && <> <Link to="/search">Найти мастера</Link></>}
        </div>
      )}

      <div className="list">
        {query.data?.items.map((a) => (
          <article key={a.id} className="list-item">
            <div className="row between">
              <strong>{a.service_name}</strong>
              <span className={`badge ${statusBadgeClass(a.status)}`}>{statusLabel(a.status)}</span>
            </div>
            <p>
              {new Date(a.starts_at).toLocaleString('ru-RU')} · {formatMoney(a.price_minor)}
            </p>
            <div className="row">
              <Link className="btn btn-secondary btn-compact" to={`/appointments/${a.id}`}>Открыть</Link>
              {role === 'master' && a.status === 'pending_confirmation' && (
                <button
                  className="btn btn-primary btn-compact"
                  type="button"
                  disabled={confirm.isPending}
                  onClick={() => confirm.mutate(a.id)}
                >
                  Подтвердить
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}

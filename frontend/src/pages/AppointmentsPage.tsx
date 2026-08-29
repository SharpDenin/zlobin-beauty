import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { apiRequest } from '@/shared/api/client'
import { userError } from '@/shared/lib/app-error'
import { hasMasterAccess, useAuth } from '@/features/auth/AuthProvider'
import { AppointmentCard } from '@/shared/ui/AppointmentCard'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { Modal } from '@/shared/ui/Modal'
import { PageHeader } from '@/app/layout'

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
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('Не могу принять запись')
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
    onError: (e) => setActionError(userError(e, 'Не удалось подтвердить запись')),
  })

  const reject = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      apiRequest(`/v1/appointments/${input.id}/reject`, {
        method: 'POST',
        token: accessToken,
        body: { reason: input.reason },
      }),
    onSuccess: async () => {
      setActionError(null)
      setRejectId(null)
      await qc.invalidateQueries({ queryKey: ['appointments'] })
    },
    onError: (e) => setActionError(userError(e, 'Не удалось отклонить запись')),
  })

  return (
    <main className="page stack">
      <PageHeader
        title="Записи"
        actions={canMaster ? (
          <div className="segmented segmented--2" role="group" aria-label="Роль в записях">
            <label className={role === 'client' ? 'is-active' : ''}>
              <input type="radio" name="appt-role" checked={role === 'client'} onChange={() => setRole('client')} />
              Клиент
            </label>
            <label className={role === 'master' ? 'is-active' : ''}>
              <input type="radio" name="appt-role" checked={role === 'master'} onChange={() => setRole('master')} />
              Мастер
            </label>
          </div>
        ) : undefined}
      />

      {actionError && <ErrorBanner error={actionError} />}
      {query.isLoading && (
        <div className="list">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      )}
      {query.isError && (
        <div className="stack">
          <ErrorBanner error={query.error} fallbackTitle="Не удалось загрузить записи" />
          <button className="btn btn-secondary" type="button" onClick={() => void query.refetch()}>Повторить</button>
        </div>
      )}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="Записей пока нет"
          text={role === 'client' ? 'Выберите мастера и удобное время.' : 'Новые заявки появятся здесь.'}
          action={role === 'client' ? <Link className="btn btn-primary" to="/search">Найти мастера</Link> : undefined}
        />
      )}

      <div className="list">
        {query.data?.items.map((a) => (
          <AppointmentCard
            key={a.id}
            to={`/appointments/${a.id}`}
            serviceName={a.service_name}
            status={a.status}
            startsAt={a.starts_at}
            priceMinor={a.price_minor}
            actions={role === 'master' && a.status === 'pending_confirmation' ? (
              <>
                <button
                  className="btn btn-primary btn-compact"
                  type="button"
                  disabled={confirm.isPending || reject.isPending}
                  onClick={() => confirm.mutate(a.id)}
                >
                  Подтвердить
                </button>
                <button
                  className="btn btn-secondary btn-compact"
                  type="button"
                  disabled={confirm.isPending || reject.isPending}
                  onClick={() => {
                    setRejectReason('Не могу принять запись')
                    setRejectId(a.id)
                  }}
                >
                  Отклонить
                </button>
              </>
            ) : undefined}
          />
        ))}
      </div>

      <Modal
        open={Boolean(rejectId)}
        onClose={() => setRejectId(null)}
        title="Отклонить запись"
        footer={
          <button
            className="btn btn-primary btn-block"
            type="button"
            disabled={reject.isPending || !rejectId}
            onClick={() => rejectId && reject.mutate({ id: rejectId, reason: rejectReason.trim() || 'Отклонено мастером' })}
          >
            {reject.isPending ? 'Отправляем…' : 'Отклонить'}
          </button>
        }
      >
        <div className="field">
          <label htmlFor="reject-reason">Причина</label>
          <textarea id="reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
        </div>
      </Modal>
    </main>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useState } from 'react'

type Notification = {
  id: string
  type: string
  title: string
  body: string
  entity_type: string
  entity_id: string | null
  read_at: string | null
  created_at: string
}

export function NotificationsPage() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiRequest<{ items: Notification[] }>('/v1/notifications', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const markRead = useMutation({
    mutationFn: (id: string) => apiRequest(`/v1/notifications/${id}/read`, { method: 'POST', token: accessToken }),
    onSuccess: async () => {
      setError(null)
      await qc.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось отметить'),
  })

  return (
    <main className="page stack">
      <h1>Уведомления</h1>
      {error && <div className="state-box error">{error}</div>}
      {query.isLoading && <div className="state-box">Загрузка…</div>}
      {query.isError && <div className="state-box error">Не удалось загрузить уведомления</div>}
      {query.data && query.data.items.length === 0 && <div className="state-box">Пока нет уведомлений</div>}
      <div className="list">
        {query.data?.items.map((n) => (
          <article key={n.id} className="list-item">
            <div className="row between">
              <strong>{n.title}</strong>
              {!n.read_at && <span className="badge badge-default">Новое</span>}
            </div>
            <p>{n.body}</p>
            <p>{new Date(n.created_at).toLocaleString('ru-RU')}</p>
            {!n.read_at && (
              <button className="btn btn-secondary btn-compact" type="button" disabled={markRead.isPending} onClick={() => markRead.mutate(n.id)}>
                Прочитано
              </button>
            )}
          </article>
        ))}
      </div>
    </main>
  )
}

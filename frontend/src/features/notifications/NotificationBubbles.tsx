import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { notificationHref } from '@/features/notifications/notificationHref'
import './notification-bubbles.css'

export type NotificationRow = {
  id: string
  type: string
  title: string
  body: string
  entity_type: string
  entity_id: string | null
  read_at: string | null
  hidden_at?: string | null
  deleted_at?: string | null
  created_at: string
}

export function NotificationBubbles({ limit = 3 }: { limit?: number }) {
  const { accessToken } = useAuth()
  const qc = useQueryClient()

  const bubbles = useQuery({
    queryKey: ['notification-bubbles'],
    queryFn: () => apiRequest<{ items: NotificationRow[] }>('/v1/notifications/bubbles', { token: accessToken }),
    enabled: Boolean(accessToken),
    refetchInterval: 20_000,
  })

  const markRead = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/v1/notifications/${id}/read`, { method: 'POST', token: accessToken }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['notification-bubbles'] })
      await qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const hide = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/v1/notifications/${id}`, { method: 'PATCH', token: accessToken, body: { hidden: true } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['notification-bubbles'] })
      await qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/v1/notifications/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['notification-bubbles'] })
      await qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const items = (bubbles.data?.items ?? []).slice(0, limit)
  if (!accessToken || items.length === 0) return null

  return (
    <aside className="notif-bubbles" aria-label="Уведомления" data-testid="notification-bubbles">
      {items.map((n) => (
        <article key={n.id} className={`notif-bubble${!n.read_at ? ' is-unread' : ''}`}>
          <Link
            className="notif-bubble__link"
            to={notificationHref(n)}
            onClick={() => {
              if (!n.read_at) markRead.mutate(n.id)
            }}
          >
            <strong>{n.title}</strong>
            <span>{n.body}</span>
          </Link>
          <div className="notif-bubble__actions">
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              disabled={hide.isPending}
              onClick={() => hide.mutate(n.id)}
              aria-label="Скрыть уведомление"
            >
              Скрыть
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              disabled={remove.isPending}
              onClick={() => remove.mutate(n.id)}
              aria-label="Удалить уведомление"
            >
              Удалить
            </button>
          </div>
        </article>
      ))}
    </aside>
  )
}

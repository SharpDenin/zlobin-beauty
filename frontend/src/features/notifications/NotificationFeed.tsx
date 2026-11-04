import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { notificationHref } from '@/features/notifications/notificationHref'

type Item = {
  id: string
  title: string
  body: string
  read_at: string | null
  created_at: string
  entity_type?: string
  entity_id?: string | null
}

/** Shared home-screen event feed (NOTIF-01). Uses the same notifications API for every role. */
export function NotificationFeed({ limit = 5, className }: { limit?: number; className?: string }) {
  const { accessToken } = useAuth()
  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiRequest<{ items: Item[]; unread_count?: number }>('/v1/notifications', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const items = query.data?.items ?? []
  const unread = items.filter((n) => !n.read_at).length

  return (
    <section className={className ?? 'stack'} aria-label="Лента событий" data-testid="notification-feed">
      <div className="row between">
        <h2>
          Уведомления
          {unread > 0 && <span className="badge badge-default" style={{ marginLeft: 8 }}>{unread}</span>}
        </h2>
        <Link to="/notifications">Все ›</Link>
      </div>
      {query.isLoading && <div className="state-box">Загрузка…</div>}
      {!query.isLoading && items.length === 0 && <p className="muted">Пока нет уведомлений</p>}
      <ul className="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.slice(0, limit).map((n) => (
          <li key={n.id}>
            <Link className={`list-item${!n.read_at ? ' is-unread' : ''}`} to={notificationHref(n)}>
              <strong>{n.title}</strong>
              <p className="muted">{n.body}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

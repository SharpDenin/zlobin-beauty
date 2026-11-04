import { useEffect, useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { notificationHref } from '@/features/notifications/notificationHref'
import { AppIcon } from '@/shared/ui/AppIcon'
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

function useCompactBubbles(breakpointPx = 768) {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(`(max-width: ${breakpointPx - 1}px)`).matches : true,
  )
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`)
    const onChange = () => setCompact(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [breakpointPx])
  return compact
}

export function NotificationBubbles({ limit = 3 }: { limit?: number }) {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const compact = useCompactBubbles(768)
  const panelId = useId()
  const [openId, setOpenId] = useState<string | null>(null)

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
      setOpenId(null)
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/v1/notifications/${id}`, { method: 'DELETE', token: accessToken }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['notification-bubbles'] })
      await qc.invalidateQueries({ queryKey: ['notifications'] })
      setOpenId(null)
    },
  })

  const items = (bubbles.data?.items ?? []).slice(0, limit)
  useEffect(() => {
    if (openId && !items.some((n) => n.id === openId)) setOpenId(null)
  }, [items, openId])

  if (!accessToken || items.length === 0) return null

  const openItem = openId ? items.find((n) => n.id === openId) ?? null : null

  const card = (n: NotificationRow) => (
    <article key={n.id} className={`notif-bubble${!n.read_at ? ' is-unread' : ''}`} data-testid={`notif-bubble-${n.id}`}>
      <Link
        className="notif-bubble__link"
        to={notificationHref(n)}
        onClick={() => {
          if (!n.read_at) markRead.mutate(n.id)
          setOpenId(null)
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
  )

  if (!compact) {
    return (
      <aside className="notif-bubbles notif-bubbles--desktop" aria-label="Уведомления" data-testid="notification-bubbles">
        {items.map(card)}
      </aside>
    )
  }

  return (
    <aside
      className="notif-bubbles notif-bubbles--compact"
      aria-label="Уведомления"
      data-testid="notification-bubbles"
      data-compact="true"
    >
      <div className="notif-bubbles__rail" role="toolbar" aria-orientation="vertical" aria-label="Индикаторы уведомлений">
        {items.map((n) => {
          const selected = openId === n.id
          return (
            <button
              key={n.id}
              type="button"
              className={`notif-dot${!n.read_at ? ' is-unread' : ''}${selected ? ' is-open' : ''}`}
              aria-label={n.title}
              aria-expanded={selected}
              aria-controls={selected ? panelId : undefined}
              data-testid={`notif-dot-${n.id}`}
              onClick={() => setOpenId((cur) => (cur === n.id ? null : n.id))}
            >
              <AppIcon name="bell" size={18} />
              {!n.read_at ? <span className="notif-dot__badge" aria-hidden="true" /> : null}
            </button>
          )
        })}
      </div>
      {openItem ? (
        <div id={panelId} className="notif-bubbles__panel" role="dialog" aria-label={openItem.title}>
          {card(openItem)}
          <button type="button" className="btn btn-ghost btn-compact notif-bubbles__close" onClick={() => setOpenId(null)}>
            Закрыть
          </button>
        </div>
      ) : null}
    </aside>
  )
}

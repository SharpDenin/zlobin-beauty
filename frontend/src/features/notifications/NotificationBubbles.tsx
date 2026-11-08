import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { notificationHref } from '@/features/notifications/notificationHref'
import {
  groupBubbleNotifications,
  type BubbleItem,
  type NotificationRow,
} from '@/features/notifications/groupBubbleNotifications'
import type { Conversation } from '@/features/messenger/types'
import { AppIcon } from '@/shared/ui/AppIcon'
import './notification-bubbles.css'

function useCompactBubbles(breakpointPx = 768) {
  const [compact, setCompact] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
    return window.matchMedia(`(max-width: ${breakpointPx - 1}px)`).matches
  })
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`)
    const onChange = () => setCompact(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [breakpointPx])
  return compact
}

function formatCount(n: number) {
  return n > 9 ? '9+' : String(n)
}

export function NotificationBubbles({ limit = 3 }: { limit?: number }) {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const compact = useCompactBubbles(768)
  const panelId = useId()
  const rootRef = useRef<HTMLElement | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const bubbles = useQuery({
    queryKey: ['notification-bubbles'],
    queryFn: () => apiRequest<{ items: NotificationRow[] }>('/v1/notifications/bubbles', { token: accessToken }),
    enabled: Boolean(accessToken),
    refetchInterval: 20_000,
  })

  // Shared with MessengerProvider — unread_count is the chat counter source of truth.
  const conversations = useQuery({
    queryKey: ['conversations'],
    queryFn: () => apiRequest<{ items: Conversation[] }>('/v1/conversations?limit=50', { token: accessToken }),
    enabled: Boolean(accessToken),
    refetchInterval: 20_000,
  })

  const unreadByConversation = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of conversations.data?.items ?? []) {
      map[c.id] = c.unread_count || 0
    }
    return map
  }, [conversations.data])

  const items = useMemo(() => {
    const grouped = groupBubbleNotifications(bubbles.data?.items ?? [], unreadByConversation)
    return grouped.slice(0, limit)
  }, [bubbles.data, unreadByConversation, limit])

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ['notification-bubbles'] })
    await qc.invalidateQueries({ queryKey: ['notifications'] })
    await qc.invalidateQueries({ queryKey: ['conversations'] })
  }

  const markReadMany = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        try {
          await apiRequest(`/v1/notifications/${id}/read`, { method: 'POST', token: accessToken })
        } catch {
          /* already read / gone */
        }
      }
    },
    onSuccess: () => void invalidate(),
  })

  const hideMany = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        try {
          await apiRequest(`/v1/notifications/${id}`, { method: 'PATCH', token: accessToken, body: { hidden: true } })
        } catch {
          /* ignore */
        }
      }
    },
    onSuccess: async () => {
      await invalidate()
      setOpenKey(null)
    },
  })

  const removeMany = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        try {
          await apiRequest(`/v1/notifications/${id}`, { method: 'DELETE', token: accessToken })
        } catch {
          /* ignore */
        }
      }
    },
    onSuccess: async () => {
      await invalidate()
      setOpenKey(null)
    },
  })

  useEffect(() => {
    if (openKey && !items.some((n) => n.groupKey === openKey)) setOpenKey(null)
  }, [items, openKey])

  // Collapse expanded compact bubble when pointer lands outside the bubbles root.
  useEffect(() => {
    if (!compact || !openKey) return
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current
      const target = event.target
      if (!root || !(target instanceof Node)) return
      if (root.contains(target)) return
      setOpenKey(null)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [compact, openKey])

  if (!accessToken || items.length === 0) return null

  const openItem = openKey ? items.find((n) => n.groupKey === openKey) ?? null : null

  const card = (n: BubbleItem) => (
    <article
      key={n.groupKey}
      className={`notif-bubble${!n.read_at ? ' is-unread' : ''}`}
      data-testid={`notif-bubble-${n.id}`}
      data-group-key={n.groupKey}
    >
      <Link
        className="notif-bubble__link"
        to={notificationHref(n)}
        onClick={() => {
          const unreadIds = n.groupIds.filter((id) => {
            const src = (bubbles.data?.items ?? []).find((row) => row.id === id)
            return src ? !src.read_at : id === n.id && !n.read_at
          })
          if (unreadIds.length) markReadMany.mutate(unreadIds)
          setOpenKey(null)
        }}
      >
        <strong className="notif-bubble__title">
          <span className="notif-bubble__title-text">{n.title}</span>
          {typeof n.messageCount === 'number' && n.messageCount > 0 ? (
            <span className="notif-bubble__count" aria-label={`${n.messageCount} непрочитанных`}>
              {formatCount(n.messageCount)}
            </span>
          ) : null}
        </strong>
        <span>{n.body}</span>
      </Link>
      <div className="notif-bubble__actions">
        <button
          type="button"
          className="btn btn-ghost btn-compact"
          disabled={hideMany.isPending}
          onClick={() => hideMany.mutate(n.groupIds)}
          aria-label="Скрыть уведомление"
        >
          Скрыть
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-compact"
          disabled={removeMany.isPending}
          onClick={() => removeMany.mutate(n.groupIds)}
          aria-label="Удалить уведомление"
        >
          Удалить
        </button>
      </div>
    </article>
  )

  if (!compact) {
    return (
      <aside
        ref={rootRef}
        className="notif-bubbles notif-bubbles--desktop"
        aria-label="Уведомления"
        data-testid="notification-bubbles"
      >
        {items.map(card)}
      </aside>
    )
  }

  return (
    <aside
      ref={rootRef}
      className="notif-bubbles notif-bubbles--compact"
      aria-label="Уведомления"
      data-testid="notification-bubbles"
      data-compact="true"
    >
      <div className="notif-bubbles__rail" role="toolbar" aria-orientation="vertical" aria-label="Индикаторы уведомлений">
        {items.map((n) => {
          const selected = openKey === n.groupKey
          const count = n.messageCount ?? (!n.read_at ? 1 : 0)
          return (
            <button
              key={n.groupKey}
              type="button"
              className={`notif-dot${!n.read_at ? ' is-unread' : ''}${selected ? ' is-open' : ''}`}
              aria-label={
                typeof n.messageCount === 'number' && n.messageCount > 0
                  ? `${n.title}, ${n.messageCount} непрочитанных`
                  : n.title
              }
              aria-expanded={selected}
              aria-controls={selected ? panelId : undefined}
              data-testid={`notif-dot-${n.id}`}
              data-group-key={n.groupKey}
              onClick={() => setOpenKey((cur) => (cur === n.groupKey ? null : n.groupKey))}
            >
              <AppIcon name={n.entity_type === 'conversation' ? 'chat' : 'bell'} size={18} />
              {count > 0 ? (
                <span className={`notif-dot__badge${typeof n.messageCount === 'number' ? ' notif-dot__badge--count' : ''}`} aria-hidden="true">
                  {typeof n.messageCount === 'number' ? formatCount(n.messageCount) : null}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      {openItem ? (
        <div id={panelId} className="notif-bubbles__panel" role="dialog" aria-label={openItem.title}>
          {card(openItem)}
          <button type="button" className="btn btn-ghost btn-compact notif-bubbles__close" onClick={() => setOpenKey(null)}>
            Закрыть
          </button>
        </div>
      ) : null}
    </aside>
  )
}

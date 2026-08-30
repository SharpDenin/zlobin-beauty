import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { openConversation } from '@/features/messenger/api'
import { DESKTOP_MESSENGER_MQ, isDesktopMessenger } from '@/features/messenger/helpers'
import { MessengerApp } from '@/features/messenger/MessengerApp'
import type { Conversation, CreateConversationBody } from '@/features/messenger/types'
import { Overlay } from '@/shared/ui/Overlay'
import { userError } from '@/shared/lib/app-error'
import { toast } from '@/shared/ui/Toast'

type MessengerContextValue = {
  overlayOpen: boolean
  overlayConversationId: string | null
  unreadTotal: number
  isDesktop: boolean
  open: (conversationId: string) => void
  openList: () => void
  close: () => void
  start: (body: CreateConversationBody | Record<string, unknown>) => Promise<Conversation>
}

const MessengerContext = createContext<MessengerContextValue | null>(null)

export function useMessenger() {
  const ctx = useContext(MessengerContext)
  if (!ctx) {
    throw new Error('useMessenger must be used inside MessengerProvider')
  }
  return ctx
}

export function useMessengerOptional() {
  return useContext(MessengerContext)
}

export function MessengerProvider({ children }: { children: ReactNode }) {
  const { accessToken } = useAuth()
  const navigate = useNavigate()
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [overlayConversationId, setOverlayConversationId] = useState<string | null>(null)
  const [isDesktop, setIsDesktop] = useState(isDesktopMessenger)

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MESSENGER_MQ)
    const onChange = () => setIsDesktop(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const list = useQuery({
    queryKey: ['conversations'],
    queryFn: () => apiRequest<{ items: Conversation[] }>('/v1/conversations?limit=50', { token: accessToken }),
    enabled: Boolean(accessToken),
    refetchInterval: overlayOpen ? 8000 : 15000,
  })

  const unreadTotal = useMemo(
    () => (list.data?.items ?? []).reduce((sum, c) => sum + (c.unread_count || 0), 0),
    [list.data],
  )

  const close = useCallback(() => {
    setOverlayOpen(false)
  }, [])

  const open = useCallback(
    (conversationId: string) => {
      if (isDesktop) {
        setOverlayConversationId(conversationId)
        setOverlayOpen(true)
        return
      }
      setOverlayOpen(false)
      navigate(`/messages/${conversationId}`)
    },
    [isDesktop, navigate],
  )

  const openList = useCallback(() => {
    if (isDesktop) {
      setOverlayConversationId(null)
      setOverlayOpen(true)
      return
    }
    navigate('/messages')
  }, [isDesktop, navigate])

  const start = useCallback(
    async (body: CreateConversationBody | Record<string, unknown>) => {
      try {
        const c = await openConversation(accessToken, body)
        open(c.id)
        return c
      } catch (e) {
        const msg = userError(e, 'Не удалось открыть переписку')
        toast.error(msg)
        throw e
      }
    },
    [accessToken, open],
  )

  const value = useMemo(
    () => ({ overlayOpen, overlayConversationId, unreadTotal, isDesktop, open, openList, close, start }),
    [overlayOpen, overlayConversationId, unreadTotal, isDesktop, open, openList, close, start],
  )

  return (
    <MessengerContext.Provider value={value}>
      {children}
      <Overlay
        open={overlayOpen && isDesktop}
        onClose={close}
        label="Сообщения"
        className="modal-backdrop overlay-scrim messenger-overlay"
      >
        <div className="messenger-panel overlay-panel">
          <MessengerApp
            mode="overlay"
            conversationId={overlayConversationId}
            onSelectConversation={(id) => setOverlayConversationId(id)}
            onClose={close}
          />
        </div>
      </Overlay>
    </MessengerContext.Provider>
  )
}

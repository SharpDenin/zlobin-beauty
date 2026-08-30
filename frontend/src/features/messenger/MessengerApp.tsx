import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { userError } from '@/shared/lib/app-error'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Overlay } from '@/shared/ui/Overlay'
import { MediaImage } from '@/shared/ui/MediaImage'
import { ChatMedia } from '@/features/messenger/ChatMedia'
import {
  canSendMessage,
  conversationTypeLabel,
  emptyMessengerAction,
  formatMessageTime,
  isNearBottom,
  lastMessagePreview,
  MAX_MESSAGE_CHARS,
  peerInitials,
} from '@/features/messenger/helpers'
import { MESSAGE_PAGE_SIZE, type ChatMessage, type Conversation, type MessageListResponse } from '@/features/messenger/types'
import { uploadMedia, MEDIA_ACCEPT_IMAGE_OR_VIDEO, validateMediaFile } from '@/shared/lib/mediaUpload'
import { toast } from '@/shared/ui/Toast'

type Props = {
  mode: 'page' | 'overlay'
  conversationId?: string | null
  onSelectConversation: (id: string | null) => void
  onClose?: () => void
}

type LocalMessage = ChatMessage & { file?: File }

export function MessengerApp({ mode, conversationId, onSelectConversation, onClose }: Props) {
  const { accessToken, user } = useAuth()
  const cabinet = useCabinet()
  const qc = useQueryClient()
  const id = conversationId || undefined
  const [draft, setDraft] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [filePreview, setFilePreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [local, setLocal] = useState<LocalMessage[]>([])
  const [older, setOlder] = useState<ChatMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [newBanner, setNewBanner] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const composing = useRef(false)
  const historyRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const list = useQuery({
    queryKey: ['conversations'],
    queryFn: () => apiRequest<{ items: Conversation[] }>('/v1/conversations?limit=50', { token: accessToken }),
    enabled: Boolean(accessToken),
    refetchInterval: id ? 8000 : 8000,
  })

  const conversation = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => apiRequest<Conversation>(`/v1/conversations/${id}`, { token: accessToken }),
    enabled: Boolean(accessToken && id),
    refetchInterval: 5000,
  })

  const messages = useQuery({
    queryKey: ['conversation-messages', id],
    queryFn: () =>
      apiRequest<MessageListResponse>(`/v1/conversations/${id}/messages?limit=${MESSAGE_PAGE_SIZE}`, { token: accessToken }),
    enabled: Boolean(accessToken && id),
    refetchInterval: 4000,
  })

  useEffect(() => {
    setOlder([])
    setLocal([])
    setDraft('')
    setFile(null)
    setError(null)
    setNewBanner(false)
    stickToBottom.current = true
  }, [id])

  useEffect(() => {
    if (!accessToken || !id) return
    void apiRequest(`/v1/conversations/${id}/read`, { method: 'POST', token: accessToken })
      .then(() => qc.invalidateQueries({ queryKey: ['conversations'] }))
      .catch(() => undefined)
  }, [accessToken, id, messages.data?.items.length, qc])

  useEffect(() => {
    if (!file) {
      setFilePreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setFilePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const serverItems = messages.data?.items ?? []
  const merged = useMemo(() => {
    const seen = new Set<string>()
    const out: LocalMessage[] = []
    for (const m of older) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      out.push(m)
    }
    for (const m of serverItems) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      out.push({ ...m, status: 'sent' })
    }
    for (const m of local) {
      if (m.id && seen.has(m.id)) continue
      out.push(m)
    }
    return out
  }, [older, serverItems, local])

  useEffect(() => {
    const el = historyRef.current
    if (!el) return
    const latest = merged[merged.length - 1]
    if (!latest) return
    if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight
      setNewBanner(false)
    } else if (latest.sender_user_id !== user?.id && latest.status !== 'sending') {
      setNewBanner(true)
    }
  }, [merged.length, merged, user?.id])

  useEffect(() => {
    setHasMore(Boolean(messages.data?.has_more))
  }, [messages.data?.has_more, id])

  const items = list.data?.items ?? []
  const peer = conversation.data?.peer_name
    || conversation.data?.participants.find((p) => p.user_id !== user?.id)?.display_name
    || 'Собеседник'
  const emptyAction = emptyMessengerAction(cabinet.kind)
  const showList = mode === 'overlay' ? !id : true
  const showThread = Boolean(id)

  async function loadOlder() {
    if (!id || !accessToken || loadingOlder || !hasMore) return
    const oldest = merged[0]
    if (!oldest?.created_at) return
    const el = historyRef.current
    const prevHeight = el?.scrollHeight ?? 0
    setLoadingOlder(true)
    try {
      const res = await apiRequest<MessageListResponse>(
        `/v1/conversations/${id}/messages?limit=${MESSAGE_PAGE_SIZE}&before=${encodeURIComponent(oldest.created_at)}`,
        { token: accessToken },
      )
      setOlder((cur) => [...(res.items ?? []), ...cur])
      setHasMore(Boolean(res.has_more))
      requestAnimationFrame(() => {
        if (!el) return
        el.scrollTop = el.scrollHeight - prevHeight
      })
    } catch (e) {
      setError(userError(e, 'Не удалось загрузить сообщения'))
    } finally {
      setLoadingOlder(false)
    }
  }

  function onHistoryScroll() {
    const el = historyRef.current
    if (!el) return
    stickToBottom.current = isNearBottom(el)
    if (stickToBottom.current) setNewBanner(false)
    if (el.scrollTop < 48) void loadOlder()
  }

  async function sendNow(retry?: LocalMessage) {
    if (!id || !accessToken || pending) return
    const text = retry?.body ?? draft
    const attachment = retry?.file ?? file
    if (!canSendMessage(text, attachment)) return
    const mimeErr = attachment ? validateMediaFile(attachment, { allowVideo: true }) : null
    if (mimeErr) {
      setError(mimeErr)
      return
    }
    const clientId = retry?.client_id ?? `local-${Date.now()}`
    const optimistic: LocalMessage = retry ?? {
      id: clientId,
      client_id: clientId,
      conversation_id: id,
      sender_user_id: user?.id ?? '',
      kind: attachment?.type.startsWith('video/') ? 'video' : attachment ? 'image' : 'text',
      body: text.trim(),
      created_at: new Date().toISOString(),
      status: 'sending',
      file: attachment ?? undefined,
    }
    if (!retry) {
      setLocal((cur) => [...cur, { ...optimistic, status: 'sending' }])
      setDraft('')
      setFile(null)
    } else {
      setLocal((cur) => cur.map((m) => (m.client_id === clientId ? { ...m, status: 'sending' } : m)))
    }
    setPending(true)
    setError(null)
    stickToBottom.current = true
    try {
      let mediaId: string | undefined
      if (attachment) {
        const uploaded = await uploadMedia(attachment, 'message', accessToken, undefined, {
          allowVideo: true,
          preservePurpose: true,
        })
        mediaId = uploaded.id
      }
      const saved = await apiRequest<ChatMessage>(`/v1/conversations/${id}/messages`, {
        method: 'POST',
        token: accessToken,
        body: { body: text.trim(), media_id: mediaId },
      })
      setLocal((cur) => cur.filter((m) => m.client_id !== clientId && m.id !== saved.id))
      await qc.invalidateQueries({ queryKey: ['conversation-messages', id] })
      await qc.invalidateQueries({ queryKey: ['conversations'] })
    } catch (e) {
      const msg = userError(e, 'Не удалось отправить сообщение')
      setError(msg)
      toast.error(msg)
      setLocal((cur) => cur.map((m) => (m.client_id === clientId ? { ...m, status: 'failed', body: text.trim(), file: attachment ?? m.file } : m)))
    } finally {
      setPending(false)
    }
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || composing.current) return
    e.preventDefault()
    void sendNow()
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void sendNow()
  }

  function pickFile(next: File | null) {
    if (!next) {
      setFile(null)
      return
    }
    const err = validateMediaFile(next, { allowVideo: true })
    if (err) {
      setError(err)
      return
    }
    setError(null)
    setFile(next)
  }

  const listBlock = (
    <section className="messenger-list" data-testid="conversations-list">
      <div className="messenger-list-head">
        <h2>Диалоги</h2>
        {onClose && (
          <button className="btn btn-secondary btn-compact" type="button" onClick={onClose} aria-label="Закрыть" data-overlay-initial-focus>
            Закрыть
          </button>
        )}
      </div>
      {list.isLoading && <div className="state-box">Загрузка…</div>}
      {list.isError && <ErrorBanner error={list.error} fallbackTitle="Не удалось загрузить диалоги" />}
      {!list.isLoading && items.length === 0 && (
        <EmptyState
          title="Пока нет сообщений"
          text={emptyAction ? undefined : 'Новые сообщения появятся здесь.'}
          action={
            emptyAction ? (
              <Link className="btn btn-secondary" to={emptyAction.to} onClick={onClose}>
                {emptyAction.label}
              </Link>
            ) : undefined
          }
        />
      )}
      <div className="messenger-list-scroll">
        {items.map((c) => {
          const name = c.peer_name || 'Собеседник'
          return (
            <button
              key={c.id}
              type="button"
              className={`messenger-row ${c.id === id ? 'is-selected' : ''}`}
              onClick={() => onSelectConversation(c.id)}
              data-testid={`conversation-${c.id}`}
            >
              <span className="messenger-avatar" aria-hidden="true">{peerInitials(name)}</span>
              <span className="messenger-row-body">
                <span className="row between">
                  <strong>{name}</strong>
                  {c.unread_count > 0 && (
                    <span className="badge badge-default" aria-label={`${c.unread_count} непрочитанных`}>
                      {c.unread_count}
                    </span>
                  )}
                </span>
                <span className="muted messenger-preview">{lastMessagePreview(c.last_message)}</span>
                <span className="muted messenger-meta">
                  {conversationTypeLabel(c.type)} · {formatMessageTime(c.last_message?.created_at || c.updated_at)}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )

  const threadBlock = id ? (
    <section className="messenger-thread">
      <header className="messenger-thread-head">
        <button
          className="btn btn-ghost btn-compact messenger-back"
          type="button"
          onClick={() => onSelectConversation(null)}
          aria-label="К списку диалогов"
        >
          Назад
        </button>
        <div className="messenger-thread-title">
          <h2>{peer}</h2>
          <p className="muted">{conversation.data ? conversationTypeLabel(conversation.data.type) : 'Диалог'}</p>
        </div>
        {onClose && mode === 'overlay' && showThread && !showList && (
          <button className="btn btn-secondary btn-compact" type="button" onClick={onClose} aria-label="Закрыть">
            Закрыть
          </button>
        )}
      </header>
      {conversation.isError && <ErrorBanner error={conversation.error} fallbackTitle="Нет доступа к диалогу" />}
      {error && <ErrorBanner error={error} fallbackTitle="Не удалось отправить сообщение" />}
      <div
        className="messenger-history"
        data-testid="message-history"
        ref={historyRef}
        onScroll={onHistoryScroll}
      >
        {loadingOlder && <p className="muted chat-load-older">Загрузка предыдущих сообщений…</p>}
        {messages.isLoading && <div className="state-box">Загрузка сообщений…</div>}
        {messages.isError && <ErrorBanner error={messages.error} fallbackTitle="Не удалось загрузить сообщения" />}
        {!messages.isLoading && merged.length === 0 && <p className="muted">Напишите первое сообщение.</p>}
        {merged.map((m) => {
          const own = m.sender_user_id === user?.id
          return (
            <article
              key={m.client_id || m.id}
              className={`chat-bubble ${own ? 'is-own' : 'is-in'} ${m.status === 'failed' ? 'is-failed' : ''}`}
            >
              {m.media_id && m.status !== 'sending' && (
                <ChatMedia
                  mediaId={m.media_id}
                  token={accessToken}
                  kind={m.kind}
                  alt={m.kind === 'video' ? 'Видео' : 'Фото'}
                  onOpenImage={() => setLightbox(m.media_id!)}
                />
              )}
              {m.file && !m.media_id && (
                <PendingAttach file={m.file} />
              )}
              {m.body ? <p className="chat-bubble-text">{m.body}</p> : null}
              <span className="chat-bubble-meta">
                {formatMessageTime(m.created_at)}
                {own && m.status === 'sending' ? ' · Отправка' : ''}
                {own && m.status === 'failed' ? ' · Не отправлено' : ''}
              </span>
              {m.status === 'failed' && (
                <button className="btn btn-ghost btn-compact" type="button" onClick={() => void sendNow(m)}>
                  Повторить
                </button>
              )}
            </article>
          )
        })}
      </div>
      {newBanner && (
        <button
          className="chat-new-msg"
          type="button"
          onClick={() => {
            const el = historyRef.current
            if (el) el.scrollTop = el.scrollHeight
            stickToBottom.current = true
            setNewBanner(false)
          }}
        >
          Новое сообщение
        </button>
      )}
      <form className="messenger-composer" onSubmit={onSubmit}>
        {file && (
          <div className="composer-preview">
            {file.type.startsWith('video/') ? (
              <video src={filePreview ?? undefined} muted playsInline />
            ) : (
              <img src={filePreview ?? undefined} alt="Предпросмотр" />
            )}
            <button className="btn btn-ghost btn-compact" type="button" onClick={() => setFile(null)} aria-label="Убрать файл">
              Убрать
            </button>
          </div>
        )}
        <div className="composer-row">
          <input
            ref={fileInputRef}
            type="file"
            accept={MEDIA_ACCEPT_IMAGE_OR_VIDEO}
            hidden
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          <button
            className="btn btn-secondary composer-attach"
            type="button"
            aria-label="Прикрепить фото или видео"
            onClick={() => fileInputRef.current?.click()}
          >
            Файл
          </button>
          <label className="visually-hidden" htmlFor={`message-body-${mode}`}>Сообщение</label>
          <textarea
            id={`message-body-${mode}`}
            data-testid="message-composer"
            rows={1}
            value={draft}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder="Сообщение"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKey}
            onCompositionStart={() => { composing.current = true }}
            onCompositionEnd={() => { composing.current = false }}
          />
          <button
            className="btn btn-primary composer-send"
            type="submit"
            data-testid="send-message"
            disabled={pending || !canSendMessage(draft, file)}
          >
            Отправить
          </button>
        </div>
      </form>
    </section>
  ) : null

  return (
    <div className={`messenger-app messenger-app--${mode} ${id ? 'has-thread' : ''}`}>
      {showList && listBlock}
      {showThread && threadBlock}
      <Overlay
        open={Boolean(lightbox)}
        onClose={() => setLightbox(null)}
        closeOnAnyClick
        label="Просмотр изображения"
        className="kb-lightbox overlay-scrim"
      >
        {lightbox && <MediaImage mediaId={lightbox} token={accessToken} alt="Вложение" />}
      </Overlay>
    </div>
  )
}

function PendingAttach({ file }: { file: File }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  if (!src) return null
  if (file.type.startsWith('video/')) {
    return <video src={src} muted playsInline className="chat-pending-thumb" />
  }
  return <img src={src} alt="" className="chat-pending-thumb" />
}

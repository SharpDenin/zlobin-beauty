import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'

export type Conversation = {
  id: string
  type: string
  peer_name: string
  unread_count: number
  updated_at: string
  last_message?: { body: string; created_at: string; sender_user_id: string } | null
  participants: Array<{ user_id: string; display_name: string; role: string }>
  context_id?: string | null
}

export type ChatMessage = {
  id: string
  body: string
  sender_user_id: string
  created_at: string
}

export async function openConversation(
  token: string | null,
  body: Record<string, unknown>,
): Promise<Conversation> {
  return apiRequest<Conversation>('/v1/conversations', { method: 'POST', token, body })
}

function typeLabel(type: string) {
  switch (type) {
    case 'client_master':
      return 'Клиент и мастер'
    case 'master_supplier':
      return 'Мастер и поставщик'
    case 'masterclass':
      return 'Мастер-класс'
    case 'model_request':
      return 'Модели'
    default:
      return 'Диалог'
  }
}

export function MessagesPage() {
  const { id } = useParams()
  const { accessToken, user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['conversations'],
    queryFn: () => apiRequest<{ items: Conversation[] }>('/v1/conversations', { token: accessToken }),
    enabled: Boolean(accessToken),
    refetchInterval: 8000,
  })

  const conversation = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => apiRequest<Conversation>(`/v1/conversations/${id}`, { token: accessToken }),
    enabled: Boolean(accessToken && id),
    refetchInterval: 5000,
  })

  const messages = useQuery({
    queryKey: ['conversation-messages', id],
    queryFn: () => apiRequest<{ items: ChatMessage[] }>(`/v1/conversations/${id}/messages?limit=50`, { token: accessToken }),
    enabled: Boolean(accessToken && id),
    refetchInterval: 4000,
  })

  useEffect(() => {
    if (!accessToken || !id) return
    void apiRequest(`/v1/conversations/${id}/read`, { method: 'POST', token: accessToken })
      .then(() => qc.invalidateQueries({ queryKey: ['conversations'] }))
      .catch(() => undefined)
  }, [accessToken, id, messages.data?.items.length, qc])

  const send = useMutation({
    mutationFn: () =>
      apiRequest(`/v1/conversations/${id}/messages`, {
        method: 'POST',
        token: accessToken,
        body: { body: draft },
      }),
    onSuccess: async () => {
      setDraft('')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['conversation-messages', id] })
      await qc.invalidateQueries({ queryKey: ['conversations'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось отправить'),
  })

  const items = list.data?.items ?? []
  const peer = useMemo(() => {
    const c = conversation.data
    if (!c) return ''
    return c.peer_name || c.participants.find((p) => p.user_id !== user?.id)?.display_name || 'Собеседник'
  }, [conversation.data, user?.id])

  return (
    <main className="page stack">
      <h1>Сообщения</h1>
      <p className="muted">Переписка с мастерами, клиентами и поставщиками. Уведомления остаются отдельным разделом.</p>
      {error && <div className="state-box error">{error}</div>}
      <div className="cards-grid" style={{ gridTemplateColumns: id ? 'minmax(0, 1fr)' : undefined }}>
        <section className="card stack" data-testid="conversations-list">
          <h2>Диалоги</h2>
          {list.isLoading && <div className="state-box">Загрузка…</div>}
          {list.isError && <div className="state-box error">Не удалось загрузить диалоги</div>}
          {!list.isLoading && items.length === 0 && <div className="empty-state"><h2>Пока нет сообщений</h2><p>Напишите мастеру с его карточки или поставщику из каталога.</p></div>}
          <div className="list">
            {items.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`list-item ${c.id === id ? 'selected' : ''}`}
                onClick={() => navigate(`/messages/${c.id}`)}
                data-testid={`conversation-${c.id}`}
              >
                <div className="row between">
                  <strong>{c.peer_name || 'Собеседник'}</strong>
                  {c.unread_count > 0 && <span className="badge badge-default">{c.unread_count}</span>}
                </div>
                <p className="muted">{typeLabel(c.type)}</p>
                <p>{c.last_message?.body || 'Нет сообщений'}</p>
                <p className="muted">{new Date(c.last_message?.created_at || c.updated_at).toLocaleString('ru-RU')}</p>
              </button>
            ))}
          </div>
        </section>

        {id && (
          <section className="card stack">
            {conversation.isError && <div className="state-box error">Нет доступа к диалогу</div>}
            {conversation.isLoading && <div className="state-box">Загрузка диалога…</div>}
            {conversation.data && (
              <>
                <div className="row between">
                  <div>
                    <h2>{peer}</h2>
                    <p className="muted">{typeLabel(conversation.data.type)}</p>
                  </div>
                  <Link className="btn btn-ghost btn-compact" to="/messages">К списку</Link>
                </div>
                <div className="stack-sm" data-testid="message-history">
                  {messages.isLoading && <div className="state-box">Загрузка сообщений…</div>}
                  {(messages.data?.items ?? []).map((m) => (
                    <article key={m.id} className="list-item">
                      <div className="row between">
                        <strong>{m.sender_user_id === user?.id ? 'Вы' : peer}</strong>
                        <span className="muted">{new Date(m.created_at).toLocaleString('ru-RU')}</span>
                      </div>
                      <p>{m.body}</p>
                    </article>
                  ))}
                  {(messages.data?.items.length ?? 0) === 0 && !messages.isLoading && (
                    <p className="muted">Напишите первое сообщение.</p>
                  )}
                </div>
                <form
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (draft.trim()) send.mutate()
                  }}
                >
                  <div className="field">
                    <label htmlFor="message-body">Сообщение</label>
                    <textarea
                      id="message-body"
                      data-testid="message-composer"
                      rows={3}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Текст сообщения"
                    />
                  </div>
                  <button className="btn btn-primary" type="submit" data-testid="send-message" disabled={send.isPending || !draft.trim()}>
                    Отправить
                  </button>
                </form>
              </>
            )}
          </section>
        )}
      </div>
    </main>
  )
}

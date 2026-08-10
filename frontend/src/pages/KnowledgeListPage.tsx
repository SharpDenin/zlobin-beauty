import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiRequest } from '@/shared/api/client'
import { hasMasterAccess, hasSupplierAccess, useAuth } from '@/features/auth/AuthProvider'
import { useSupplierOrg } from '@/shared/lib/commerce'
import { productStateLabel, statusBadgeClass } from '@/shared/lib/status'

type Article = {
  id: string
  title: string
  category: string
  content?: string
  author_name: string
  author_org_id?: string | null
  product_id?: string | null
  published?: boolean
  created_at: string
}

async function fetchMyKnowledge(token: string | null): Promise<Article[] | null> {
  try {
    const res = await apiRequest<{ items: Article[] }>('/v1/me/knowledge', { token })
    return res.items ?? []
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 501)) return null
    throw e
  }
}

export function KnowledgeListPage() {
  const { accessToken, user } = useAuth()
  const isSupplier = hasSupplierAccess(user) && !hasMasterAccess(user)
  const isMaster = hasMasterAccess(user)
  const { supplierOrgId } = useSupplierOrg()
  const qc = useQueryClient()
  const [category, setCategory] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [draft, setDraft] = useState({ title: '', category: '', content: '', published: true })

  const published = useQuery({
    queryKey: ['knowledge', submitted],
    queryFn: () => {
      const qs = submitted ? `?category=${encodeURIComponent(submitted)}` : ''
      return apiRequest<{ items: Article[] }>(`/v1/knowledge${qs}`, { token: accessToken })
    },
    enabled: Boolean(accessToken) && !isSupplier,
  })

  const mine = useQuery({
    queryKey: ['knowledge-mine', supplierOrgId],
    queryFn: async () => {
      const own = await fetchMyKnowledge(accessToken)
      if (own) return own
      const all = await apiRequest<{ items: Article[] }>('/v1/knowledge?include_unpublished=1', { token: accessToken }).catch(async () => {
        return apiRequest<{ items: Article[] }>('/v1/knowledge', { token: accessToken })
      })
      return (all.items ?? []).filter((a) => !supplierOrgId || a.author_org_id === supplierOrgId)
    },
    enabled: Boolean(accessToken && isSupplier),
  })

  const create = useMutation({
    mutationFn: () =>
      apiRequest('/v1/knowledge', {
        token: accessToken,
        body: {
          title: draft.title.trim(),
          category: draft.category.trim(),
          content: draft.content.trim(),
          author_name: user?.display_name ?? '',
          organization_id: supplierOrgId,
          published: draft.published,
        },
      }),
    onSuccess: async () => {
      setOk('Статья сохранена')
      setError(null)
      setDraft({ title: '', category: '', content: '', published: true })
      await qc.invalidateQueries({ queryKey: ['knowledge-mine'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось сохранить'),
  })

  const togglePublish = useMutation({
    mutationFn: (input: { id: string; published: boolean }) =>
      apiRequest(`/v1/knowledge/${input.id}`, {
        method: 'PATCH',
        token: accessToken,
        body: { published: input.published },
      }),
    onSuccess: async () => {
      setOk('Статус публикации обновлён')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['knowledge-mine'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось обновить публикацию'),
  })

  const items = useMemo(
    () => (isSupplier ? (mine.data ?? []) : (published.data?.items ?? [])),
    [isSupplier, mine.data, published.data],
  )

  return (
    <main className="page stack">
      <div className="stack-sm">
        <h1>База знаний</h1>
        <p className="muted">
          {isSupplier ? 'Ваши материалы для мастеров' : isMaster ? 'Опубликованные статьи и техники' : 'Полезные материалы'}
        </p>
      </div>

      {!isSupplier && (
        <form
          className="card search-form"
          onSubmit={(e) => {
            e.preventDefault()
            setSubmitted(category.trim())
          }}
        >
          <div className="field">
            <label htmlFor="category">Категория</label>
            <input
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Например: техники, материалы"
            />
          </div>
          <button className="btn btn-primary" type="submit">Фильтровать</button>
          {submitted && (
            <button className="btn btn-secondary" type="button" onClick={() => { setCategory(''); setSubmitted('') }}>
              Сбросить
            </button>
          )}
        </form>
      )}

      {isSupplier && (
        <section className="card stack">
          <h2>Новая статья</h2>
          {error && <div className="state-box error">{error}</div>}
          {ok && <div className="state-box success">{ok}</div>}
          <div className="field">
            <label>Заголовок</label>
            <input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
          </div>
          <div className="field">
            <label>Категория</label>
            <input value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} />
          </div>
          <div className="field">
            <label>Текст</label>
            <textarea value={draft.content} onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))} />
          </div>
          <label className="field-check">
            <input
              type="checkbox"
              checked={draft.published}
              onChange={(e) => setDraft((d) => ({ ...d, published: e.target.checked }))}
            />
            <span>Опубликовать сразу</span>
          </label>
          <button
            className="btn btn-primary"
            type="button"
            disabled={create.isPending || draft.title.trim().length < 2 || draft.content.trim().length < 2}
            onClick={() => create.mutate()}
          >
            Сохранить статью
          </button>
        </section>
      )}

      {(isSupplier ? mine.isLoading : published.isLoading) && <div className="state-box">Загрузка…</div>}
      {(isSupplier ? mine.isError : published.isError) && <div className="state-box error">Не удалось загрузить статьи</div>}
      {!mine.isLoading && !published.isLoading && items.length === 0 && (
        <div className="empty-state">
          <h2>Статей пока нет</h2>
          <p>{isSupplier ? 'Создайте первую статью для мастеров.' : 'Опубликованные материалы появятся здесь.'}</p>
        </div>
      )}

      <div className="list">
        {items.map((a) => (
          <article key={a.id} className="list-item">
            <Link to={`/knowledge/${a.id}`} className="stack-sm">
              <div className="row between">
                <strong>{a.title}</strong>
                <div className="row">
                  {a.category && <span className="badge badge-default">{a.category}</span>}
                  {typeof a.published === 'boolean' && (
                    <span className={`badge ${statusBadgeClass(a.published ? 'published' : 'draft')}`}>
                      {productStateLabel(a.published ? 'published' : 'draft')}
                    </span>
                  )}
                </div>
              </div>
              <p className="muted">
                {a.author_name || 'Автор не указан'}
                {' · '}
                {new Date(a.created_at).toLocaleDateString('ru-RU')}
              </p>
            </Link>
            {isSupplier && typeof a.published === 'boolean' && (
              <button
                className="btn btn-secondary btn-compact"
                type="button"
                disabled={togglePublish.isPending}
                onClick={() => togglePublish.mutate({ id: a.id, published: !a.published })}
              >
                {a.published ? 'Снять с публикации' : 'Опубликовать'}
              </button>
            )}
          </article>
        ))}
      </div>
    </main>
  )
}

import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/react'
import { ApiError, apiRequest } from '@/shared/api/client'
import { hasMasterAccess, hasSupplierAccess, useAuth } from '@/features/auth/AuthProvider'
import { useSupplierOrg } from '@/shared/lib/commerce'
import { productStateLabel, statusBadgeClass } from '@/shared/lib/status'
import { emptyDoc, estimateReadingMinutes, docHasText, RichDocEditor } from '@/shared/ui/RichDocEditor'
import { MediaDropzone } from '@/shared/ui/MediaDropzone'

type Article = {
  id: string
  title: string
  category: string
  content?: string
  content_format?: string
  cover_media_id?: string | null
  reading_time_minutes?: number
  brand?: string
  author_name: string
  author_org_id?: string | null
  product_id?: string | null
  published?: boolean
  created_at: string
}

type Draft = {
  id?: string
  title: string
  category: string
  brand: string
  doc: JSONContent
  coverMediaId: string | null
  published: boolean
}

const emptyDraft = (): Draft => ({
  title: '',
  category: '',
  brand: '',
  doc: emptyDoc(),
  coverMediaId: null,
  published: true,
})

function parseDoc(content?: string, format?: string): JSONContent {
  if ((format || 'plain') === 'doc_json' && content) {
    try {
      const parsed = JSON.parse(content) as JSONContent
      if (parsed?.type === 'doc') return parsed
    } catch {
      /* fall through */
    }
  }
  if (!content?.trim()) return emptyDoc()
  return {
    type: 'doc',
    content: content.split(/\n+/).map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  }
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
  const [brand, setBrand] = useState('')
  const [search, setSearch] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [submitted, setSubmitted] = useState({ category: '', brand: '', q: '', favorites: false })
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)

  const published = useQuery({
    queryKey: ['knowledge', submitted],
    queryFn: () => {
      const p = new URLSearchParams()
      if (submitted.category) p.set('category', submitted.category)
      if (submitted.brand) p.set('brand', submitted.brand)
      if (submitted.q) p.set('q', submitted.q)
      if (submitted.favorites) p.set('favorites', '1')
      const qs = p.toString() ? `?${p.toString()}` : ''
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

  const save = useMutation({
    mutationFn: () => {
      const content = JSON.stringify(draft.doc)
      const body = {
        title: draft.title.trim(),
        category: draft.category.trim(),
        brand: draft.brand.trim(),
        content,
        content_format: 'doc_json',
        cover_media_id: draft.coverMediaId,
        reading_time_minutes: estimateReadingMinutes(draft.doc),
        author_name: user?.display_name ?? '',
        organization_id: supplierOrgId,
        published: draft.published,
      }
      if (draft.id) {
        return apiRequest(`/v1/knowledge/${draft.id}`, {
          method: 'PUT',
          token: accessToken,
          body,
        })
      }
      return apiRequest('/v1/knowledge', {
        token: accessToken,
        body,
      })
    },
    onSuccess: async () => {
      setOk(draft.id ? 'Статья обновлена' : 'Статья сохранена')
      setError(null)
      setDraft(emptyDraft())
      await qc.invalidateQueries({ queryKey: ['knowledge-mine'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось сохранить'),
  })

  const togglePublish = useMutation({
    mutationFn: (input: { article: Article; published: boolean }) =>
      apiRequest(`/v1/knowledge/${input.article.id}`, {
        method: 'PUT',
        token: accessToken,
        body: {
          title: input.article.title,
          category: input.article.category,
          content: input.article.content ?? '',
          content_format: input.article.content_format || 'plain',
          cover_media_id: input.article.cover_media_id ?? null,
          reading_time_minutes: input.article.reading_time_minutes ?? 0,
          brand: input.article.brand ?? '',
          author_name: input.article.author_name,
          organization_id: supplierOrgId,
          published: input.published,
        },
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

  function startEdit(a: Article) {
    setDraft({
      id: a.id,
      title: a.title,
      category: a.category,
      brand: a.brand ?? '',
      doc: parseDoc(a.content, a.content_format),
      coverMediaId: a.cover_media_id ?? null,
      published: a.published !== false,
    })
    setOk(null)
    setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const canSave = draft.title.trim().length >= 2 && docHasText(draft.doc)

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
            setSubmitted({ category: category.trim(), brand: brand.trim(), q: search.trim(), favorites: favoritesOnly })
          }}
        >
          <div className="field">
            <label htmlFor="kb-search">Поиск</label>
            <input id="kb-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Текст статьи" />
          </div>
          <div className="field">
            <label htmlFor="category">Категория</label>
            <input
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Например: колористика"
            />
          </div>
          <div className="field">
            <label htmlFor="brand">Бренд</label>
            <input id="brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="L'Oreal" />
          </div>
          <div className="row">
            <button className="chip" type="button" onClick={() => { setFavoritesOnly((v) => !v); setSubmitted((s) => ({ ...s, favorites: !favoritesOnly })) }}>
              {favoritesOnly ? 'Избранное включено' : 'Только избранное'}
            </button>
            <button className="chip" type="button" onClick={() => { setCategory('Колористика'); setSubmitted((s) => ({ ...s, category: 'Колористика' })) }}>Колористика</button>
            <button className="chip" type="button" onClick={() => { setBrand("L'Oreal"); setSubmitted((s) => ({ ...s, brand: "L'Oreal" })) }}>L'Oreal</button>
          </div>
          <button className="btn btn-primary" type="submit">Фильтровать</button>
          {(submitted.category || submitted.brand || submitted.q || submitted.favorites) && (
            <button className="btn btn-secondary" type="button" onClick={() => { setCategory(''); setBrand(''); setSearch(''); setFavoritesOnly(false); setSubmitted({ category: '', brand: '', q: '', favorites: false }) }}>
              Сбросить
            </button>
          )}
        </form>
      )}

      {isSupplier && (
        <section className="card stack">
          <h2>{draft.id ? 'Редактирование статьи' : 'Новая статья'}</h2>
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
            <label>Бренд</label>
            <input value={draft.brand} onChange={(e) => setDraft((d) => ({ ...d, brand: e.target.value }))} placeholder="Опционально" />
          </div>
          <MediaDropzone
            purpose="article"
            value={draft.coverMediaId}
            onChange={(id) => setDraft((d) => ({ ...d, coverMediaId: id }))}
            label="Обложка: перетащите изображение или нажмите для выбора"
          />
          <div className="field">
            <label>Текст</label>
            <RichDocEditor
              value={draft.doc}
              onChange={(doc) => setDraft((d) => ({ ...d, doc }))}
              token={accessToken}
              imagePurpose="article"
            />
          </div>
          <label className="field-check">
            <input
              type="checkbox"
              checked={draft.published}
              onChange={(e) => setDraft((d) => ({ ...d, published: e.target.checked }))}
            />
            <span>Опубликовать сразу</span>
          </label>
          <div className="row">
            <button
              className="btn btn-primary"
              type="button"
              disabled={save.isPending || !canSave}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Сохраняем…' : draft.id ? 'Обновить статью' : 'Сохранить статью'}
            </button>
            {draft.id && (
              <button className="btn btn-secondary" type="button" onClick={() => setDraft(emptyDraft())}>
                Отменить редактирование
              </button>
            )}
          </div>
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
                {[a.brand, a.author_name || 'Автор не указан', new Date(a.created_at).toLocaleDateString('ru-RU')]
                  .filter(Boolean)
                  .join(' · ')}
                {typeof a.reading_time_minutes === 'number' && a.reading_time_minutes > 0
                  ? ` · ${a.reading_time_minutes} мин`
                  : null}
              </p>
            </Link>
            {isSupplier && (
              <div className="row">
                <button className="btn btn-secondary btn-compact" type="button" onClick={() => startEdit(a)}>
                  Редактировать
                </button>
                {typeof a.published === 'boolean' && (
                  <button
                    className="btn btn-secondary btn-compact"
                    type="button"
                    disabled={togglePublish.isPending}
                    onClick={() => togglePublish.mutate({ article: a, published: !a.published })}
                  >
                    {a.published ? 'Снять с публикации' : 'Опубликовать'}
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </main>
  )
}

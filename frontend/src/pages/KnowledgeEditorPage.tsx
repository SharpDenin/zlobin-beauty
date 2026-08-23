import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/react'
import { ApiError, apiRequest } from '@/shared/api/client'
import { hasSupplierAccess, useAuth } from '@/features/auth/AuthProvider'
import { useSupplierOrg } from '@/shared/lib/commerce'
import { SearchableMultiSelect } from '@/features/knowledge/SearchableMultiSelect'
import type { KnowledgeArticle } from '@/features/knowledge/types'
import { emptyDoc, estimateReadingMinutes, docHasText, RichDocEditor } from '@/shared/ui/RichDocEditor'
import { MediaDropzone } from '@/shared/ui/MediaDropzone'
import { RichDocRenderer } from '@/shared/ui/RichDocRenderer'
import { productStateLabel, statusBadgeClass } from '@/shared/lib/status'

type SupplierProduct = { id: string; brand?: string; name: string; category?: string }
type ProductCategory = { id: string; name: string }

type Draft = {
  title: string
  category: string
  brand: string
  doc: JSONContent
  coverMediaId: string | null
  status: 'draft' | 'published' | 'archived'
  productIds: string[]
  categoryIds: string[]
}

const emptyDraft = (): Draft => ({
  title: '',
  category: '',
  brand: '',
  doc: emptyDoc(),
  coverMediaId: null,
  status: 'draft',
  productIds: [],
  categoryIds: [],
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

export function KnowledgeEditorPage() {
  const { id } = useParams()
  const isNew = !id
  const { accessToken, user } = useAuth()
  const { supplierOrgId } = useSupplierOrg()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [productQ, setProductQ] = useState('')

  const existing = useQuery({
    queryKey: ['knowledge', id],
    queryFn: () => apiRequest<KnowledgeArticle>(`/v1/knowledge/${id}`, { token: accessToken }),
    enabled: Boolean(accessToken && id),
  })

  useEffect(() => {
    if (!existing.data) return
    const a = existing.data
    setDraft({
      title: a.title,
      category: a.category,
      brand: a.brand ?? '',
      doc: parseDoc(a.content, a.content_format),
      coverMediaId: a.cover_media_id ?? null,
      status: (a.status as Draft['status']) || (a.published ? 'published' : 'draft'),
      productIds: a.product_ids ?? (a.product_id ? [a.product_id] : []),
      categoryIds: a.category_ids ?? [],
    })
  }, [existing.data])

  const products = useQuery({
    queryKey: ['knowledge-supplier-products', supplierOrgId],
    queryFn: () =>
      apiRequest<{ items: SupplierProduct[] }>(
        `/v1/commerce/products?organization_id=${encodeURIComponent(supplierOrgId ?? '')}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && supplierOrgId),
  })

  const categories = useQuery({
    queryKey: ['kb-product-categories'],
    queryFn: () => apiRequest<{ items: ProductCategory[] }>('/v1/commerce/product-categories', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const productItems = products.data?.items ?? []
  const brands = useMemo(
    () => [...new Set(productItems.map((p) => p.brand).filter(Boolean))] as string[],
    [productItems],
  )
  const filteredProducts = useMemo(() => {
    const needle = productQ.trim().toLowerCase()
    return productItems.filter((p) => {
      if (draft.productIds.includes(p.id)) return false
      if (!needle) return true
      return [p.brand, p.name, p.category].filter(Boolean).join(' ').toLowerCase().includes(needle)
    }).slice(0, 12)
  }, [productItems, draft.productIds, productQ])

  const save = useMutation({
    mutationFn: async (status: Draft['status']) => {
      const body = {
        title: draft.title.trim(),
        category: draft.category.trim(),
        brand: draft.brand.trim(),
        content: JSON.stringify(draft.doc),
        content_format: 'doc_json',
        cover_media_id: draft.coverMediaId,
        reading_time_minutes: estimateReadingMinutes(draft.doc),
        author_name: user?.display_name ?? '',
        organization_id: supplierOrgId,
        status,
        published: status === 'published',
        product_ids: draft.productIds,
        category_ids: draft.categoryIds,
      }
      if (id) {
        return apiRequest<KnowledgeArticle>(`/v1/knowledge/${id}`, { method: 'PUT', token: accessToken, body })
      }
      return apiRequest<KnowledgeArticle>('/v1/knowledge', { token: accessToken, body })
    },
    onSuccess: async (item, status) => {
      setOk(status === 'published' ? 'Материал опубликован' : 'Черновик сохранён')
      setError(null)
      setDraft((d) => ({ ...d, status }))
      await qc.invalidateQueries({ queryKey: ['knowledge-mine'] })
      await qc.invalidateQueries({ queryKey: ['knowledge', item.id] })
      if (!id) navigate(`/knowledge/${item.id}/edit`, { replace: true })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось сохранить'),
  })

  const setStatus = useMutation({
    mutationFn: (status: 'published' | 'draft' | 'archived') => {
      const path = status === 'published' ? 'publish' : status === 'archived' ? 'archive' : 'unpublish'
      return apiRequest<KnowledgeArticle>(`/v1/knowledge/${id}/${path}`, { method: 'POST', token: accessToken })
    },
    onSuccess: async (item) => {
      setOk(item.status === 'published' ? 'Опубликовано' : item.status === 'archived' ? 'В архиве' : 'Снято с публикации')
      setDraft((d) => ({ ...d, status: (item.status as Draft['status']) || 'draft' }))
      await qc.invalidateQueries({ queryKey: ['knowledge-mine'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось изменить статус'),
  })

  if (!hasSupplierAccess(user)) {
    return (
      <main className="page stack">
        <div className="state-box error">Редактор доступен только поставщику</div>
        <Link className="btn btn-secondary" to="/knowledge">К базе знаний</Link>
      </main>
    )
  }

  if (!isNew && existing.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (!isNew && existing.isError) {
    return (
      <main className="page stack">
        <div className="state-box error">Материал не найден или нет доступа</div>
        <Link className="btn btn-secondary" to="/knowledge">Назад</Link>
      </main>
    )
  }

  const canSave = draft.title.trim().length >= 2 && docHasText(draft.doc)
  const reading = estimateReadingMinutes(draft.doc)

  if (preview) {
    return (
      <main className="page stack kb-article">
        <div className="row">
          <button className="btn btn-secondary" type="button" onClick={() => setPreview(false)}>К редактору</button>
          <span className={`badge ${statusBadgeClass(draft.status)}`}>{productStateLabel(draft.status)}</span>
        </div>
        <article className="kb-article-column stack">
          <h1>{draft.title || 'Без названия'}</h1>
          <p className="muted">{[draft.brand, draft.category, reading ? `${reading} мин` : null].filter(Boolean).join(' · ')}</p>
          <RichDocRenderer content={JSON.stringify(draft.doc)} contentFormat="doc_json" token={accessToken} />
        </article>
      </main>
    )
  }

  return (
    <main className="page stack kb-editor">
      <div className="row between">
        <div>
          <h1>{isNew ? 'Новый материал' : 'Редактирование'}</h1>
          <p className="muted">CMS для инструкций, технологий и рекомендаций.</p>
        </div>
        <Link className="btn btn-ghost" to="/knowledge">К списку</Link>
      </div>
      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      <section className="card stack">
        <h2>Основное</h2>
        <div className="field">
          <label htmlFor="kb-title">Заголовок</label>
          <input id="kb-title" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
        </div>
        <div className="filters-grid">
          <div className="field">
            <label htmlFor="kb-cat">Категория материала</label>
            <input id="kb-cat" list="kb-cat-list" value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} placeholder="Колористика, Уход…" />
            <datalist id="kb-cat-list">
              {['Колористика', 'Уход', 'Стайлинг', 'Продукция', 'Процедуры', 'Салон'].map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="field">
            <label htmlFor="kb-brand">Бренд</label>
            <input id="kb-brand" list="kb-brand-list" value={draft.brand} onChange={(e) => setDraft((d) => ({ ...d, brand: e.target.value }))} placeholder="Из каталога товаров" />
            <datalist id="kb-brand-list">
              {brands.map((b) => <option key={b} value={b} />)}
            </datalist>
          </div>
        </div>
        <MediaDropzone
          purpose="article"
          value={draft.coverMediaId}
          onChange={(id) => setDraft((d) => ({ ...d, coverMediaId: id }))}
          label="Обложка: перетащите изображение или нажмите"
        />
      </section>

      <section className="card stack">
        <h2>Связи</h2>
        <p className="muted">Можно привязать категорию каталога без конкретного товара — или выбрать свои продукты.</p>
        <SearchableMultiSelect
          id="kb-rel-cats"
          label="Категории товаров"
          options={(categories.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
          values={draft.categoryIds}
          onChange={(categoryIds) => setDraft((d) => ({ ...d, categoryIds }))}
        />
        <div className="field">
          <label htmlFor="kb-rel-products">Товары</label>
          {draft.productIds.length > 0 && (
            <div className="chip-row">
              {draft.productIds.map((pid) => {
                const p = productItems.find((x) => x.id === pid)
                return (
                  <button key={pid} type="button" className="chip active" onClick={() => setDraft((d) => ({ ...d, productIds: d.productIds.filter((x) => x !== pid) }))}>
                    {p ? [p.brand, p.name].filter(Boolean).join(' · ') : 'Товар'} ×
                  </button>
                )
              })}
            </div>
          )}
          <input id="kb-rel-products" value={productQ} onChange={(e) => setProductQ(e.target.value)} placeholder="Поиск по своим товарам" />
          <ul className="kb-suggest">
            {filteredProducts.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => { setDraft((d) => ({ ...d, productIds: [...d.productIds, p.id] })); setProductQ('') }}>
                  {[p.brand, p.name].filter(Boolean).join(' · ')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card stack">
        <h2>Материал</h2>
        <RichDocEditor value={draft.doc} onChange={(doc) => setDraft((d) => ({ ...d, doc }))} token={accessToken} imagePurpose="article" />
        {reading > 0 && <p className="muted">Время чтения: {reading} мин (считается автоматически)</p>}
      </section>

      <section className="card stack">
        <h2>Публикация</h2>
        <p>
          Статус: <span className={`badge ${statusBadgeClass(draft.status)}`}>{productStateLabel(draft.status)}</span>
        </p>
        <div className="row wrap">
          <button className="btn btn-secondary" type="button" disabled={!canSave || save.isPending} onClick={() => save.mutate('draft')}>
            Сохранить черновик
          </button>
          <button className="btn btn-secondary" type="button" disabled={!canSave} onClick={() => setPreview(true)}>
            Предпросмотр
          </button>
          <button className="btn btn-primary" type="button" disabled={!canSave || save.isPending} onClick={() => save.mutate('published')}>
            Опубликовать
          </button>
          {id && draft.status === 'published' && (
            <button className="btn btn-ghost" type="button" disabled={setStatus.isPending} onClick={() => setStatus.mutate('draft')}>
              Снять с публикации
            </button>
          )}
          {id && draft.status !== 'archived' && (
            <button className="btn btn-ghost" type="button" disabled={setStatus.isPending} onClick={() => setStatus.mutate('archived')}>
              В архив
            </button>
          )}
        </div>
      </section>
    </main>
  )
}

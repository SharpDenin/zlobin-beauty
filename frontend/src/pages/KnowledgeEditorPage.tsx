import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/react'
import { apiRequest } from '@/shared/api/client'
import { hasSupplierAccess, useAuth } from '@/features/auth/AuthProvider'
import { useSupplierOrg } from '@/shared/lib/commerce'
import { SearchableMultiSelect } from '@/features/knowledge/SearchableMultiSelect'
import { knowledgeCoverClearValue, parseKnowledgeDoc, productAudienceLabel } from '@/pages/knowledge-helpers'
import type { KnowledgeArticle } from '@/features/knowledge/types'
import { emptyDoc, estimateReadingMinutes, docHasText, RichDocEditor } from '@/shared/ui/RichDocEditor'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { EmptyState } from '@/shared/ui/EmptyState'
import { MediaDropzone } from '@/shared/ui/MediaDropzone'
import { RichDocRenderer } from '@/shared/ui/RichDocRenderer'
import { Modal } from '@/shared/ui/Modal'
import { Drawer } from '@/shared/ui/Drawer'
import { productStateLabel, statusBadgeClass } from '@/shared/lib/status'
import '@/features/knowledge/knowledge-tones.css'

type SupplierProduct = { id: string; brand?: string; name: string; category?: string; audience?: string }
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

export function KnowledgeEditorPage() {
  const { id } = useParams()
  const isNew = !id
  const { accessToken, user } = useAuth()
  const { supplierOrgId } = useSupplierOrg()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [hydrated, setHydrated] = useState(isNew)
  const [error, setError] = useState<unknown>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [productQ, setProductQ] = useState('')
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [actionsDrawer, setActionsDrawer] = useState(false)
  const hydratedForId = useRef<string | null>(null)

  const existing = useQuery({
    queryKey: ['knowledge', id],
    queryFn: () => apiRequest<KnowledgeArticle>(`/v1/knowledge/${id}`, { token: accessToken }),
    enabled: Boolean(accessToken && id),
  })

  useEffect(() => {
    hydratedForId.current = null
    setHydrated(isNew)
    if (isNew) setDraft(emptyDraft())
  }, [id, isNew])

  useEffect(() => {
    if (!existing.data) return
    if (hydratedForId.current === existing.data.id) return
    const a = existing.data
    setDraft({
      title: a.title,
      category: a.category,
      brand: a.brand ?? '',
      doc: parseKnowledgeDoc(a.content, a.content_format),
      coverMediaId: a.cover_media_id ?? null,
      status: (a.status as Draft['status']) || (a.published ? 'published' : 'draft'),
      productIds: a.product_ids ?? (a.product_id ? [a.product_id] : []),
      categoryIds: a.category_ids ?? [],
    })
    hydratedForId.current = a.id
    setHydrated(true)
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
        cover_media_id: knowledgeCoverClearValue(draft.coverMediaId),
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
    onError: (e) => setError(e),
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
    onError: (e) => setError(e),
  })

  if (!hasSupplierAccess(user)) {
    return (
      <main className="page stack">
        <ErrorBanner error="Редактор доступен только поставщику" />
        <EmptyState
          title="Нет доступа"
          text="Материалы редактирует поставщик, которому принадлежит статья."
          action={<Link className="btn btn-secondary" to="/knowledge">К базе знаний</Link>}
        />
      </main>
    )
  }

  if (!isNew && existing.isError) {
    return (
      <main className="page stack">
        <ErrorBanner error={existing.error} fallbackTitle="Материал не найден" />
        <EmptyState
          title="Материал не найден"
          text="Нет доступа или статья удалена."
          action={<Link className="btn btn-secondary" to="/knowledge">Назад</Link>}
        />
      </main>
    )
  }
  if (!isNew && (existing.isLoading || !hydrated)) {
    return (
      <main className="page stack kb-editor" aria-busy="true">
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-card" />
      </main>
    )
  }

  const canSave = draft.title.trim().length >= 2 && docHasText(draft.doc)
  const reading = estimateReadingMinutes(draft.doc)
  const linkedProducts = draft.productIds
    .map((pid) => productItems.find((x) => x.id === pid))
    .filter(Boolean) as SupplierProduct[]

  if (preview) {
    return (
      <main className="page stack kb-article">
        <div className="row wrap">
          <button className="btn btn-secondary" type="button" onClick={() => setPreview(false)}>К редактору</button>
          <span className={`badge ${statusBadgeClass(draft.status)}`}>{productStateLabel(draft.status)}</span>
        </div>
        <article className="kb-article-column stack">
          <h1>{draft.title || 'Без названия'}</h1>
          <p className="muted">{[user?.display_name, draft.brand, draft.category, reading ? `${reading} мин` : null].filter(Boolean).join(' · ')}</p>
          <RichDocRenderer content={JSON.stringify(draft.doc)} contentFormat="doc_json" token={accessToken} />
        </article>
      </main>
    )
  }

  return (
    <main className="page stack kb-editor" data-testid="kb-editor">
      <div className="row between wrap">
        <div>
          <h1>{isNew ? 'Новый материал' : 'Редактирование'}</h1>
          <p className="muted">Инструкции, технологии и рекомендации к товарам каталога.</p>
        </div>
        <Link className="btn btn-ghost" to="/knowledge">К списку</Link>
      </div>
      <ErrorBanner error={error} fallbackTitle="Не удалось сохранить материал" />
      {ok && <p className="muted" role="status">{ok}</p>}

      <div className="kb-editor-layout">
        <section className="card stack kb-ed-title">
          <h2>Заголовок</h2>
          <div className="field">
            <label htmlFor="kb-title">Название статьи</label>
            <input
              id="kb-title"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              aria-invalid={draft.title.trim().length > 0 && draft.title.trim().length < 2}
            />
            {draft.title.trim().length > 0 && draft.title.trim().length < 2 && (
              <span className="error">Укажите заголовок не короче двух символов.</span>
            )}
          </div>
          <div className="kb-editor-meta">
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
        </section>

        <section className="card stack kb-ed-status">
          <h2>Статус</h2>
          <p>
            <span className={`badge ${statusBadgeClass(draft.status)}`}>{productStateLabel(draft.status)}</span>
          </p>
          <p className="muted">Автор: {user?.display_name || 'Поставщик'}</p>
          {reading > 0 && <p className="muted">Время чтения: {reading} мин</p>}
        </section>

        <section className="card stack kb-ed-content">
          <h2>Материал</h2>
          <RichDocEditor
            key={id ?? 'new'}
            value={draft.doc}
            onChange={(doc) => setDraft((d) => {
              if (!docHasText(doc) && docHasText(d.doc)) return d
              return { ...d, doc }
            })}
            token={accessToken}
            imagePurpose="article"
          />
        </section>

        <section className="card stack kb-ed-media">
          <h2>Обложка</h2>
          <MediaDropzone
            purpose="article"
            value={draft.coverMediaId}
            onChange={(id) => setDraft((d) => ({ ...d, coverMediaId: id }))}
            label="Обложка: перетащите изображение или нажмите"
          />
        </section>

        <section className="card stack kb-ed-products">
          <h2>Связанные товары</h2>
          <p className="muted">Клиенты увидят статью, только если среди товаров есть косметика для домашнего ухода.</p>
          {draft.productIds.length === 0 ? (
            <EmptyState title="Связанных товаров пока нет" text="Найдите товар в каталоге и добавьте его к статье." />
          ) : (
            <div className="chip-row">
              {draft.productIds.map((pid) => {
                const p = productItems.find((x) => x.id === pid)
                return (
                  <button
                    key={pid}
                    type="button"
                    className="chip active kb-product-chip"
                    data-testid="kb-related-product"
                    onClick={() => setDraft((d) => ({ ...d, productIds: d.productIds.filter((x) => x !== pid) }))}
                  >
                    <span>{p ? [p.brand, p.name].filter(Boolean).join(' · ') : 'Товар'}</span>
                    <span className="badge badge-default">{productAudienceLabel(p?.audience)}</span>
                    ×
                  </button>
                )
              })}
            </div>
          )}
          {linkedProducts.length > 0 && linkedProducts.every((p) => p.audience === 'professional_only') && (
            <p className="muted">Сейчас привязаны только салонные товары — для клиентов статья останется скрытой.</p>
          )}
          <div className="field">
            <label htmlFor="kb-rel-products">Добавить товар</label>
            <input id="kb-rel-products" value={productQ} onChange={(e) => setProductQ(e.target.value)} placeholder="Поиск по своим товарам" />
            <ul className="kb-suggest">
              {filteredProducts.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => { setDraft((d) => ({ ...d, productIds: [...d.productIds, p.id] })); setProductQ('') }}>
                    {[p.brand, p.name].filter(Boolean).join(' · ')}
                    <span className="muted"> · {productAudienceLabel(p.audience)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="card stack kb-ed-cats">
          <h2>Категории товаров</h2>
          <SearchableMultiSelect
            id="kb-rel-cats"
            label="Связанные категории"
            options={(categories.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
            values={draft.categoryIds}
            onChange={(categoryIds) => setDraft((d) => ({ ...d, categoryIds }))}
          />
        </section>

        <section className="card stack kb-ed-actions kb-editor-actions">
          <h2>Действия</h2>
          <div className="kb-editor-actions-bar kb-editor-mobile-actions-trigger">
            <button
              className="btn btn-primary"
              type="button"
              disabled={!canSave || save.isPending}
              onClick={() => save.mutate('published')}
            >
              Опубликовать
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              aria-haspopup="dialog"
              onClick={() => setActionsDrawer(true)}
            >
              Ещё…
            </button>
          </div>
          <div className="stack-sm kb-editor-action-list kb-editor-desktop-actions">
            <EditorActionButtons
              canSave={canSave}
              savePending={save.isPending}
              statusPending={setStatus.isPending}
              id={id}
              status={draft.status}
              onDraft={() => save.mutate('draft')}
              onPreview={() => setPreview(true)}
              onPublish={() => save.mutate('published')}
              onUnpublish={() => setStatus.mutate('draft')}
              onRestore={() => setStatus.mutate('draft')}
              onArchive={() => setConfirmArchive(true)}
              includePublish
            />
          </div>
        </section>
      </div>

      <Drawer open={actionsDrawer} onClose={() => setActionsDrawer(false)} title="Действия" label="Действия со статьёй">
        <div className="stack-sm">
          <EditorActionButtons
            canSave={canSave}
            savePending={save.isPending}
            statusPending={setStatus.isPending}
            id={id}
            status={draft.status}
            onDraft={() => { setActionsDrawer(false); save.mutate('draft') }}
            onPreview={() => { setActionsDrawer(false); setPreview(true) }}
            onPublish={() => { setActionsDrawer(false); save.mutate('published') }}
            onUnpublish={() => { setActionsDrawer(false); setStatus.mutate('draft') }}
            onRestore={() => { setActionsDrawer(false); setStatus.mutate('draft') }}
            onArchive={() => { setActionsDrawer(false); setConfirmArchive(true) }}
            includePublish
          />
        </div>
      </Drawer>

      <Modal open={confirmArchive} onClose={() => setConfirmArchive(false)} title="Архивировать материал?">
        <p>Статья исчезнет из публичной базы знаний. Её можно будет вернуть в черновики.</p>
        <div className="row wrap">
          <button className="btn btn-secondary" type="button" onClick={() => setConfirmArchive(false)}>Отмена</button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              setConfirmArchive(false)
              setStatus.mutate('archived')
            }}
          >
            В архив
          </button>
        </div>
      </Modal>
    </main>
  )
}

function EditorActionButtons({
  canSave,
  savePending,
  statusPending,
  id,
  status,
  onDraft,
  onPreview,
  onPublish,
  onUnpublish,
  onRestore,
  onArchive,
  includePublish = false,
}: {
  canSave: boolean
  savePending: boolean
  statusPending: boolean
  id?: string
  status: Draft['status']
  onDraft: () => void
  onPreview: () => void
  onPublish?: () => void
  onUnpublish: () => void
  onRestore: () => void
  onArchive: () => void
  includePublish?: boolean
}) {
  return (
    <>
      <button className="btn btn-secondary" type="button" disabled={!canSave || savePending} onClick={onDraft}>
        Сохранить черновик
      </button>
      <button className="btn btn-secondary" type="button" disabled={!canSave} onClick={onPreview}>
        Предпросмотр
      </button>
      {includePublish && onPublish && (
        <button className="btn btn-primary" type="button" disabled={!canSave || savePending} onClick={onPublish}>
          Опубликовать
        </button>
      )}
      {id && status === 'published' && (
        <button className="btn btn-ghost" type="button" disabled={statusPending} onClick={onUnpublish}>
          Снять с публикации
        </button>
      )}
      {id && status === 'archived' && (
        <button className="btn btn-secondary" type="button" disabled={statusPending} onClick={onRestore}>
          Вернуть в черновики
        </button>
      )}
      {id && status !== 'archived' && (
        <button className="btn btn-ghost" type="button" disabled={statusPending} onClick={onArchive}>
          В архив
        </button>
      )}
    </>
  )
}

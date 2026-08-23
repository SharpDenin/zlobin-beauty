import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { hasMasterAccess, hasSupplierAccess, useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { productStateLabel, statusBadgeClass } from '@/shared/lib/status'
import { MediaImage } from '@/shared/ui/MediaImage'
import { RichDocRenderer } from '@/shared/ui/RichDocRenderer'
import { KnowledgeCard } from '@/features/knowledge/KnowledgeCard'
import type { KnowledgeArticle, KnowledgeListResponse } from '@/features/knowledge/types'

type RelatedProduct = {
  id: string
  name: string
  brand: string
  price_minor: number
  photo_media_id?: string | null
  volume_label?: string
  audience?: string
  for_sale?: boolean
  published?: boolean
}

export function KnowledgeArticlePage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { accessToken, user } = useAuth()
  const qc = useQueryClient()
  const professional = hasMasterAccess(user)
  const supplier = hasSupplierAccess(user)

  const query = useQuery({
    queryKey: ['knowledge', id],
    queryFn: () => apiRequest<KnowledgeArticle>(`/v1/knowledge/${id}`, { token: accessToken }),
    enabled: Boolean(accessToken && id),
    staleTime: 60_000,
  })

  const productIds = query.data?.product_ids?.length
    ? query.data.product_ids
    : query.data?.product_id
      ? [query.data.product_id]
      : []

  const related = useQuery({
    queryKey: ['knowledge-related-products', id, productIds.join(',')],
    queryFn: async () => {
      const items: RelatedProduct[] = []
      for (const pid of productIds.slice(0, 8)) {
        try {
          const p = await apiRequest<RelatedProduct>(
            professional ? `/v1/commerce/products/${pid}` : `/v1/commerce/shop/products/${pid}`,
            { token: accessToken },
          )
          items.push(p)
        } catch {
          /* skip unpublished / invisible */
        }
      }
      return items
    },
    enabled: Boolean(accessToken && productIds.length),
  })

  const relatedArticles = useQuery({
    queryKey: ['knowledge-related-articles', id, productIds[0]],
    queryFn: () =>
      apiRequest<KnowledgeListResponse>(
        `/v1/knowledge?product_id=${productIds[0]}&exclude_id=${id}&limit=6`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && id && productIds[0]),
  })

  const fav = useMutation({
    mutationFn: async () => {
      if (query.data?.favorite) {
        await apiRequest(`/v1/knowledge/${id}/favorite`, { method: 'DELETE', token: accessToken })
        return false
      }
      await apiRequest(`/v1/knowledge/${id}/favorite`, { method: 'POST', token: accessToken })
      return true
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['knowledge', id] })
      const prev = query.data
      qc.setQueryData(['knowledge', id], prev ? { ...prev, favorite: !prev.favorite } : prev)
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['knowledge', id], ctx.prev)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['knowledge', id] })
      void qc.invalidateQueries({ queryKey: ['knowledge'] })
    },
  })

  if (query.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (query.isError || !query.data) {
    return (
      <main className="page stack">
        <div className="state-box error">Статья не найдена</div>
        <Link className="btn btn-secondary" to="/knowledge">К списку</Link>
      </main>
    )
  }

  const a = query.data
  const reading = a.reading_time_minutes && a.reading_time_minutes > 0
    ? `${a.reading_time_minutes} мин чтения`
    : null
  const productHref = (pid: string) => professional ? `/cosmetics/products/${pid}` : `/shop/${pid}`
  const publishedOn = a.published_at || a.created_at
  const supplierHref = a.author_org_id ? `/knowledge?supplier=${a.author_org_id}` : '/knowledge'
  const isPreview = params.get('preview') === '1'

  return (
    <main className="page stack kb-article">
      <div className="row between">
        <Link className="btn btn-ghost btn-compact" to="/knowledge">← К базе знаний</Link>
        {supplier && (
          <Link className="btn btn-secondary btn-compact" to={`/knowledge/${a.id}/edit`}>Редактировать</Link>
        )}
      </div>
      {isPreview && <div className="state-box">Предпросмотр</div>}
      {a.cover_media_id && (
        <div className="article-cover">
          <MediaImage mediaId={a.cover_media_id} token={accessToken} alt={a.title} />
        </div>
      )}
      <article className="kb-article-column stack">
        <div className="stack-sm">
          <h1>{a.title}</h1>
          <div className="row">
            {a.brand && <span className="badge badge-default">{a.brand}</span>}
            {a.category && <span className="badge badge-default">{a.category}</span>}
            {typeof a.published === 'boolean' && supplier && (
              <span className={`badge ${statusBadgeClass(a.status || (a.published ? 'published' : 'draft'))}`}>
                {productStateLabel(a.status || (a.published ? 'published' : 'draft'))}
              </span>
            )}
          </div>
          <p className="muted">
            <Link to={supplierHref}>{a.author_name || 'Поставщик'}</Link>
            {' · '}
            {new Date(publishedOn).toLocaleDateString('ru-RU')}
            {reading ? ` · ${reading}` : ''}
          </p>
          {productIds.length > 0 && related.data && related.data.length > 0 && (
            <div className="chip-row">
              {related.data.slice(0, 6).map((p) => (
                <Link key={p.id} className="chip" to={productHref(p.id)}>{[p.brand, p.name].filter(Boolean).join(' · ')}</Link>
              ))}
            </div>
          )}
          <button className="btn btn-secondary btn-compact" type="button" disabled={fav.isPending} onClick={() => fav.mutate()}>
            {a.favorite ? 'Убрать из избранного' : 'В избранное'}
          </button>
        </div>
        <RichDocRenderer content={a.content ?? ''} contentFormat={a.content_format} token={accessToken} />
      </article>

      {(related.data?.length ?? 0) > 0 && (
        <section className="stack-sm">
          <h2>Связанные товары</h2>
          <div className="product-grid">
            {related.data!.map((p) => (
              <Link key={p.id} className="product-card" to={productHref(p.id)}>
                {p.photo_media_id ? (
                  <MediaImage mediaId={p.photo_media_id} token={accessToken} alt={p.name} className="product-photo" />
                ) : (
                  <div className="product-photo placeholder">{p.brand || 'Salon-X'}</div>
                )}
                <p className="muted">{[p.brand, p.volume_label].filter(Boolean).join(' · ')}</p>
                <strong>{p.name}</strong>
                <span>{formatMoney(p.price_minor)}</span>
                <span className="muted">
                  {p.audience === 'professional_only' ? 'Для мастеров' : 'Доступен в каталоге'}
                </span>
                <span className="btn btn-secondary btn-compact">Открыть товар</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {(relatedArticles.data?.items?.length ?? 0) > 0 && (
        <section className="stack-sm">
          <h2>Ещё материалы по этому продукту</h2>
          <div className="kb-grid">
            {relatedArticles.data!.items.map((item) => (
              <KnowledgeCard key={item.id} article={item} token={accessToken} />
            ))}
          </div>
        </section>
      )}
    </main>
  )
}

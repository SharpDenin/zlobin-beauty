import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { hasMasterAccess, useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { productStateLabel, statusBadgeClass } from '@/shared/lib/status'
import { MediaImage } from '@/shared/ui/MediaImage'
import { RichDocRenderer } from '@/shared/ui/RichDocRenderer'

type Article = {
  id: string
  title: string
  category: string
  content: string
  content_format?: string
  cover_media_id?: string | null
  reading_time_minutes?: number
  brand?: string
  author_name: string
  product_id?: string | null
  product_ids?: string[]
  favorite?: boolean
  published?: boolean
  created_at: string
}

type RelatedProduct = {
  id: string
  name: string
  brand: string
  price_minor: number
  photo_media_id?: string | null
  volume_label?: string
}

export function KnowledgeArticlePage() {
  const { id } = useParams()
  const { accessToken, user } = useAuth()
  const qc = useQueryClient()
  const professional = hasMasterAccess(user)

  const query = useQuery({
    queryKey: ['knowledge', id],
    queryFn: () => apiRequest<Article>(`/v1/knowledge/${id}`, { token: accessToken }),
    enabled: Boolean(accessToken && id),
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

  const fav = useMutation({
    mutationFn: () =>
      apiRequest(`/v1/knowledge/${id}/favorite`, {
        method: query.data?.favorite ? 'DELETE' : 'POST',
        token: accessToken,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge', id] }),
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

  return (
    <main className="page stack">
      <Link className="btn btn-ghost btn-compact" to="/knowledge">← К списку</Link>
      {a.cover_media_id && (
        <div className="article-cover">
          <MediaImage mediaId={a.cover_media_id} token={accessToken} alt={a.title} />
        </div>
      )}
      <div className="stack-sm">
        <h1>{a.title}</h1>
        <div className="row">
          {a.brand && <span className="badge badge-default">{a.brand}</span>}
          {a.category && <span className="badge badge-default">{a.category}</span>}
          {typeof a.published === 'boolean' && (
            <span className={`badge ${statusBadgeClass(a.published ? 'published' : 'draft')}`}>
              {productStateLabel(a.published ? 'published' : 'draft')}
            </span>
          )}
        </div>
        <p className="muted">
          {[a.author_name || 'Автор не указан', new Date(a.created_at).toLocaleDateString('ru-RU'), reading]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <button className="btn btn-secondary btn-compact" type="button" disabled={fav.isPending} onClick={() => fav.mutate()}>
          {a.favorite ? 'Убрать из избранного' : 'Избранное'}
        </button>
      </div>
      <section className="card">
        <RichDocRenderer
          content={a.content}
          contentFormat={a.content_format}
          token={accessToken}
        />
      </section>
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
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}

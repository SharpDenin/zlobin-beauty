import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
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
  published?: boolean
  created_at: string
}

export function KnowledgeArticlePage() {
  const { id } = useParams()
  const { accessToken } = useAuth()

  const query = useQuery({
    queryKey: ['knowledge', id],
    queryFn: () => apiRequest<Article>(`/v1/knowledge/${id}`, { token: accessToken }),
    enabled: Boolean(accessToken && id),
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
      </div>
      <section className="card">
        <RichDocRenderer
          content={a.content}
          contentFormat={a.content_format}
          token={accessToken}
        />
      </section>
      {a.product_id && (
        <Link className="btn btn-secondary" to={`/cosmetics/products/${a.product_id}`}>
          Открыть связанный товар
        </Link>
      )}
    </main>
  )
}

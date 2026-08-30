import { Link } from 'react-router-dom'
import { MediaImage } from '@/shared/ui/MediaImage'
import type { KnowledgeArticle } from '@/features/knowledge/types'
import { articleAudienceBadges } from '@/pages/knowledge-helpers'

type Props = {
  article: KnowledgeArticle
  token?: string | null
  onFavorite?: (article: KnowledgeArticle) => void
  favoritePending?: boolean
  showAudience?: boolean
}

export function KnowledgeCard({ article: a, token, onFavorite, favoritePending, showAudience }: Props) {
  const reading = a.reading_time_minutes && a.reading_time_minutes > 0 ? `${a.reading_time_minutes} мин` : null
  const chips = [a.brand, a.category].filter(Boolean).slice(0, 2)
  const audience = showAudience ? articleAudienceBadges(a) : []

  return (
    <article className="kb-card">
      <Link to={`/knowledge/${a.id}`} className="kb-card-link" data-testid="kb-article">
        <div className="kb-cover">
          {a.cover_media_id ? (
            <MediaImage mediaId={a.cover_media_id} token={token} alt="" className="product-photo" />
          ) : (
            <div className="product-photo placeholder">{(a.category || a.title || 'KB').slice(0, 2)}</div>
          )}
        </div>
        <strong>{a.title}</strong>
        {a.excerpt ? <p className="muted kb-card-excerpt">{a.excerpt}</p> : null}
        <p className="muted">{[a.author_name, reading].filter(Boolean).join(' · ')}</p>
        {(chips.length > 0 || audience.length > 0) && (
          <div className="chip-row">
            {audience.map((b) => (
              <span key={b.id} className={`badge ${b.id === 'home' ? 'badge-success' : 'badge-default'}`}>{b.label}</span>
            ))}
            {chips.map((c) => (
              <span key={c} className="chip">{c}</span>
            ))}
          </div>
        )}
      </Link>
      {onFavorite && (
        <button
          type="button"
          className={`kb-fav ${a.favorite ? 'is-on' : ''}`}
          aria-label={a.favorite ? 'Убрать из избранного' : 'В избранное'}
          disabled={favoritePending}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onFavorite(a)
          }}
        >
          {a.favorite ? '★' : '☆'}
        </button>
      )}
    </article>
  )
}

export function KnowledgeCardSkeleton() {
  return (
    <article className="kb-card" aria-hidden="true">
      <div className="kb-cover"><div className="skeleton skeleton-card kb-skel-cover" /></div>
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-line kb-skel-excerpt" />
    </article>
  )
}

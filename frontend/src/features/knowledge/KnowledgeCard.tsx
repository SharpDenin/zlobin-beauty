import { Link } from 'react-router-dom'
import { MediaImage } from '@/shared/ui/MediaImage'
import type { KnowledgeArticle } from '@/features/knowledge/types'

type Props = {
  article: KnowledgeArticle
  token?: string | null
  onFavorite?: (article: KnowledgeArticle) => void
  favoritePending?: boolean
}

export function KnowledgeCard({ article: a, token, onFavorite, favoritePending }: Props) {
  const reading = a.reading_time_minutes && a.reading_time_minutes > 0 ? `${a.reading_time_minutes} мин` : null
  const chips = [a.brand, a.category].filter(Boolean).slice(0, 2)

  return (
    <article className="kb-card">
      <Link to={`/knowledge/${a.id}`} className="kb-card-link">
        <div className="kb-cover">
          {a.cover_media_id ? (
            <MediaImage mediaId={a.cover_media_id} token={token} alt="" className="product-photo" />
          ) : (
            <div className="product-photo placeholder">{(a.category || 'KB').slice(0, 2)}</div>
          )}
        </div>
        <strong>{a.title}</strong>
        <p className="muted">{[a.author_name, reading].filter(Boolean).join(' · ')}</p>
        {chips.length > 0 && (
          <div className="chip-row">
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

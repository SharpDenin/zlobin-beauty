import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { MediaImage } from '@/shared/ui/MediaImage'
import type { KnowledgeArticle } from '@/features/knowledge/types'
import { articleAudienceBadges, knowledgeSectionToneClass, knowledgeSeriesLabel } from '@/pages/knowledge-helpers'
import '@/features/knowledge/knowledge-tones.css'

type Props = {
  article: KnowledgeArticle
  token?: string | null
  onFavorite?: (article: KnowledgeArticle) => void
  favoritePending?: boolean
  showAudience?: boolean
  actions?: ReactNode
}

export function KnowledgeCard({ article: a, token, onFavorite, favoritePending, showAudience, actions }: Props) {
  const reading = a.reading_time_minutes && a.reading_time_minutes > 0 ? `${a.reading_time_minutes} мин` : null
  const series = knowledgeSeriesLabel(a.title)
  const categoryLabel = a.category?.includes(' / ') ? a.category.split(' / ').at(-1) : a.category
  const chips = [a.brand, categoryLabel].filter(Boolean).slice(0, 2)
  const audience = showAudience ? articleAudienceBadges(a) : []
  const productCover = Boolean(a.category?.includes(' / '))
  const tone = a.category ? knowledgeSectionToneClass(a.category) : 'kb-tone kb-tone--neutral'

  return (
    <article className={`kb-card ${tone}`}>
      <Link to={`/knowledge/${a.id}`} className="kb-card-link" data-testid="kb-article">
        <div className={`kb-cover ${productCover ? 'kb-cover--product' : ''}`}>
          <MediaImage
            mediaId={a.cover_media_id}
            token={token}
            alt=""
            className="product-photo"
            variant="cover"
            fallback={(a.category || a.title || 'KB').slice(0, 2)}
          />
        </div>
        <strong>{a.title}</strong>
        {a.excerpt ? <p className="muted kb-card-excerpt">{a.excerpt}</p> : null}
        <p className="muted">{[a.author_name, reading].filter(Boolean).join(' · ')}</p>
        {(chips.length > 0 || audience.length > 0) && (
          <div className="chip-row">
            {audience.map((b) => (
              <span key={b.id} className={`badge ${b.id === 'home' ? 'badge-success' : 'badge-default'}`}>{b.label}</span>
            ))}
            {series && <span className="badge badge-default">{series}</span>}
            {chips.map((c) => (
              <span key={c} className={`chip ${c === categoryLabel && a.category ? knowledgeSectionToneClass(a.category) : ''}`}>{c}</span>
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
      {actions ? <div className="kb-card-actions">{actions}</div> : null}
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

import { MediaImage } from '@/shared/ui/MediaImage'
import { initials } from '@/shared/lib/initials'
import '@/features/media-cards/media-cards.css'

type Props = {
  mediaId?: string | null
  name: string
  token?: string | null
  /** Aspect of the cover plane. */
  aspect?: 'landscape' | 'square' | 'portrait' | 'hero'
  /** Overlay title/meta on the photo (edge-to-edge cards). */
  overlay?: { title?: string; meta?: string }
  className?: string
}

/** Edge-to-edge service visual: cover + optional blur layer, graceful fallback. */
export function ServiceCardMedia({
  mediaId,
  name,
  token,
  aspect = 'landscape',
  overlay,
  className,
}: Props) {
  const aspectClass =
    aspect === 'square'
      ? 'media-first-cover--square'
      : aspect === 'portrait'
        ? 'media-first-cover--portrait'
        : aspect === 'hero'
          ? 'media-first-cover--hero'
          : 'media-first-cover--landscape'

  return (
    <div className={`media-first-cover ${aspectClass} media-frame media-frame--${aspect === 'hero' ? 'cover' : aspect} ${className ?? ''}`.trim()}>
      <MediaImage
        mediaId={mediaId}
        token={token}
        alt={name}
        fallback={initials(name)}
        variant="cover"
      />
      {overlay && (overlay.title || overlay.meta) && (
        <div className="media-first-overlay">
          {overlay.title ? <strong>{overlay.title}</strong> : null}
          {overlay.meta ? <span>{overlay.meta}</span> : null}
        </div>
      )}
    </div>
  )
}

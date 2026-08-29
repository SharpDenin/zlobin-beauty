import { MediaImage } from '@/shared/ui/MediaImage'
import { initials } from '@/shared/lib/initials'

type Props = {
  mediaId?: string | null
  name: string
  token?: string | null
}

/** Landscape service visual: photo when present, system fallback otherwise. */
export function ServiceCardMedia({ mediaId, name, token }: Props) {
  return (
    <div className="media-frame media-frame--landscape">
      <MediaImage mediaId={mediaId} token={token} alt={name} fallback={initials(name)} />
    </div>
  )
}

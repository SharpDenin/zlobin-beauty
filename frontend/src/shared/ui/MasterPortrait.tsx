import { MediaImage } from '@/shared/ui/MediaImage'
import { initials } from '@/shared/lib/initials'

type Props = {
  mediaId?: string | null
  name: string
  token?: string | null
  className?: string
}

/** Circular master portrait. Missing photo uses the system initials fallback. */
export function MasterPortrait({ mediaId, name, token, className }: Props) {
  return (
    <div className={`avatar-circle ${className ?? ''}`.trim()}>
      <MediaImage mediaId={mediaId} token={token} alt={name} fallback={initials(name)} />
    </div>
  )
}

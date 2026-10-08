import { MediaImage } from '@/shared/ui/MediaImage'
import { initials } from '@/shared/lib/initials'
import { roleLabels } from '@/features/contacts/roleLabels'
import type { Contact, ContactSearchHit } from '@/features/contacts/types'

type AvatarProps = {
  mediaId?: string | null
  name: string
  token?: string | null
  className?: string
}

export function ContactAvatar({ mediaId, name, token, className }: AvatarProps) {
  return (
    <div className={`contacts-avatar ${className ?? ''}`.trim()}>
      <MediaImage mediaId={mediaId} token={token} alt={name} fallback={initials(name)} />
    </div>
  )
}

export function ContactRoleBadges({ roles }: { roles: string[] }) {
  const labels = roleLabels(roles)
  if (labels.length === 0) return null
  return (
    <>
      {labels.map((label) => (
        <span key={label} className="badge badge-default">
          {label}
        </span>
      ))}
    </>
  )
}

type RowProps = {
  contact: Contact
  token?: string | null
  onOpen: (c: Contact) => void
}

export function ContactRow({ contact, token, onOpen }: RowProps) {
  return (
    <button type="button" className="contacts-row" onClick={() => onOpen(contact)} data-testid={`contact-${contact.id}`}>
      <ContactAvatar mediaId={contact.avatar_media_id} name={contact.display_name} token={token} />
      <span className="contacts-row-body">
        <strong>{contact.display_name}</strong>
        <span className="contacts-row-meta">
          <ContactRoleBadges roles={contact.roles} />
          {contact.city ? <span className="muted">{contact.city}</span> : null}
        </span>
      </span>
    </button>
  )
}

type SearchRowProps = {
  hit: ContactSearchHit
  token?: string | null
  busy?: boolean
  onAdd: (hit: ContactSearchHit) => void
}

export function ContactSearchRow({ hit, token, busy, onAdd }: SearchRowProps) {
  return (
    <div className="contacts-search-row" data-testid={`contact-search-${hit.id}`}>
      <ContactAvatar mediaId={hit.avatar_media_id} name={hit.display_name} token={token} />
      <div className="contacts-row-body">
        <strong>{hit.display_name}</strong>
        <span className="contacts-row-meta">
          <ContactRoleBadges roles={hit.roles} />
          {hit.city ? <span className="muted">{hit.city}</span> : null}
        </span>
      </div>
      {hit.already_added ? (
        <span className="badge badge-success">В контактах</span>
      ) : (
        <button className="btn btn-secondary btn-compact" type="button" disabled={busy} onClick={() => onAdd(hit)}>
          Добавить
        </button>
      )}
    </div>
  )
}

export function ContactsListSkeleton() {
  return (
    <div className="contacts-list" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="contacts-skeleton-row">
          <div className="skeleton contacts-skeleton-avatar" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skeleton skeleton-line" style={{ width: '55%' }} />
            <div className="skeleton skeleton-line" style={{ width: '35%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

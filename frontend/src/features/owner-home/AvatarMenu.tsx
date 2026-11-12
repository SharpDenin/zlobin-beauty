import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

type Props = {
  photo: boolean
  busy?: boolean
  canUpload: boolean
  children: ReactNode
  onView: () => void
  onUpload: () => void
}

/** Avatar control: tap opens actions (view / upload), no «Изменить фото» label. */
export function AvatarMenu({ photo, busy, canUpload, children, onView, onUpload }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent | PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="owner-start-avatar-wrap" ref={rootRef} data-testid="home-avatar-menu">
      <button
        type="button"
        className="owner-start-avatar owner-start-avatar-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={busy ? 'Сохраняем фото…' : 'Фото профиля'}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        data-testid="home-avatar-button"
      >
        {children}
      </button>
      {open && (
        <div className="owner-start-avatar-menu" id={menuId} role="menu" data-testid="home-avatar-actions">
          {photo && (
            <button
              type="button"
              role="menuitem"
              className="owner-start-avatar-menu-item"
              onClick={() => {
                setOpen(false)
                onView()
              }}
              data-testid="home-avatar-view"
            >
              Открыть для просмотра
            </button>
          )}
          {canUpload && (
            <button
              type="button"
              role="menuitem"
              className="owner-start-avatar-menu-item"
              onClick={() => {
                setOpen(false)
                onUpload()
              }}
              data-testid="home-avatar-upload"
            >
              Загрузить новую
            </button>
          )}
          {!photo && !canUpload && (
            <p className="muted caption" style={{ margin: 0, padding: '8px 12px' }}>
              Фото пока нет
            </p>
          )}
        </div>
      )}
    </div>
  )
}

import { useId, type ReactNode } from 'react'
import { Overlay } from '@/shared/ui/Overlay'

type DrawerProps = {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  className?: string
  panelClassName?: string
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  labelledBy?: string
  label?: string
  showClose?: boolean
  closeLabel?: string
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  className,
  panelClassName,
  closeOnBackdrop = true,
  closeOnEscape = true,
  labelledBy,
  label,
  showClose = true,
  closeLabel = 'Закрыть',
}: DrawerProps) {
  const autoId = useId()
  const titleId = title ? autoId : labelledBy
  return (
    <Overlay
      open={open}
      onClose={onClose}
      closeOnBackdrop={closeOnBackdrop}
      closeOnEscape={closeOnEscape}
      labelledBy={titleId}
      label={label}
      className={`more-drawer overlay-scrim ${className ?? ''}`.trim()}
    >
      <div className={`more-panel stack overlay-panel ${panelClassName ?? ''}`.trim()} data-overlay-scroll>
        {(title || showClose) && (
          <div className="row between">
            {title ? (typeof title === 'string' ? <h2 id={titleId}>{title}</h2> : <div id={titleId}>{title}</div>) : <span />}
            {showClose && (
              <button
                className="btn btn-secondary btn-compact"
                type="button"
                onClick={onClose}
                aria-label={closeLabel}
                data-overlay-initial-focus
              >
                {closeLabel}
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </Overlay>
  )
}

import { useId, type ReactNode } from 'react'
import { Overlay } from '@/shared/ui/Overlay'

type ModalSize = 'sm' | 'md' | 'lg'

type ModalProps = {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: ModalSize
  className?: string
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  labelledBy?: string
  label?: string
  showClose?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  className,
  closeOnBackdrop = true,
  closeOnEscape = true,
  labelledBy,
  label,
  showClose = true,
}: ModalProps) {
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
      className="modal-backdrop overlay-scrim"
    >
      <div className={`modal-sheet stack overlay-panel overlay-panel--${size} ${className ?? ''}`.trim()} data-overlay-scroll>
        {(title || showClose) && (
          <div className="row between">
            {title ? <h2 id={titleId}>{title}</h2> : <span />}
            {showClose && (
              <button
                className="btn btn-secondary btn-compact"
                type="button"
                onClick={onClose}
                aria-label="Закрыть"
                data-overlay-initial-focus
              >
                Закрыть
              </button>
            )}
          </div>
        )}
        {children}
        {footer}
      </div>
    </Overlay>
  )
}

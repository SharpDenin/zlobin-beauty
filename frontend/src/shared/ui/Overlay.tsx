import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { acquireOverlayLock, overlayLockCount, registerOverlayEscape } from '@/shared/ui/overlayLock'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusables(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
  )
}

export function useOverlayLock(open: boolean) {
  useEffect(() => {
    if (!open) return
    return acquireOverlayLock()
  }, [open])
}

type OverlayProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  labelledBy?: string
  label?: string
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  /** Lightbox-style: any click inside the overlay closes it. */
  closeOnAnyClick?: boolean
}

export function Overlay({
  open,
  onClose,
  children,
  className,
  labelledBy,
  label,
  closeOnBackdrop = true,
  closeOnEscape = true,
  closeOnAnyClick = false,
}: OverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useOverlayLock(open)

  useEffect(() => {
    if (!open || !closeOnEscape) return
    return registerOverlayEscape(onClose)
  }, [open, closeOnEscape, onClose])

  useEffect(() => {
    if (!open) return
    const root = rootRef.current
    if (!root) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const start = root.querySelector<HTMLElement>('[data-overlay-initial-focus]') ?? root
    start.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !root) return
      const items = focusables(root)
      if (items.length === 0) {
        e.preventDefault()
        root.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    root.addEventListener('keydown', onKeyDown)
    return () => {
      root.removeEventListener('keydown', onKeyDown)
      if (previous && document.contains(previous)) previous.focus()
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={rootRef}
      className={className}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      tabIndex={-1}
      data-overlay="true"
      style={{ zIndex: 50 + overlayLockCount() }}
      onClick={(e) => {
        if (closeOnAnyClick) {
          onClose()
          return
        }
        if (!closeOnBackdrop) return
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

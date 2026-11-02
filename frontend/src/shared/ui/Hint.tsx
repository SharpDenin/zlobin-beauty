import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { registerOverlayEscape } from '@/shared/ui/overlayLock'

type Props = {
  id: string
  title: string
  children: string
}

type HintCloser = () => void

let activeHintClose: HintCloser | null = null

function claimActiveHint(close: HintCloser) {
  if (activeHintClose && activeHintClose !== close) activeHintClose()
  activeHintClose = close
}

function releaseActiveHint(close: HintCloser) {
  if (activeHintClose === close) activeHintClose = null
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function Hint({ id, title, children }: Props) {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const labelId = useId()

  const prefs = useQuery({
    queryKey: ['me-hints'],
    queryFn: () =>
      apiRequest<{ hints_enabled: boolean; dismissed: string[] }>('/v1/me/hints', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const dismiss = useMutation({
    mutationFn: () =>
      apiRequest('/v1/me/hints', { method: 'PATCH', token: accessToken, body: { dismiss: id } }),
    onSuccess: () => {
      setOpen(false)
      setCoords(null)
      qc.invalidateQueries({ queryKey: ['me-hints'] })
    },
  })

  const close = useCallback(() => {
    setOpen(false)
    setCoords(null)
  }, [])

  const updatePosition = useCallback(() => {
    const trigger = wrapRef.current
    const pop = popRef.current
    if (!trigger || !pop) return
    const margin = 8
    const gap = 8
    const width = Math.min(280, Math.max(160, window.innerWidth - margin * 2))
    pop.style.width = `${width}px`
    pop.style.maxWidth = `${width}px`
    const r = trigger.getBoundingClientRect()
    const ph = pop.offsetHeight || pop.scrollHeight || 120
    let top = r.bottom + gap
    if (top + ph > window.innerHeight - margin) {
      top = r.top - ph - gap
    }
    top = clamp(top, margin, Math.max(margin, window.innerHeight - ph - margin))
    // Prefer aligning to the trigger; flip/clamp so the panel stays in the viewport.
    let left = r.left
    if (left + width > window.innerWidth - margin) {
      left = r.right - width
    }
    left = clamp(left, margin, Math.max(margin, window.innerWidth - width - margin))
    setCoords({ top, left, width })
  }, [])

  useEffect(() => {
    if (!open) {
      releaseActiveHint(close)
      return
    }
    claimActiveHint(close)
    return () => releaseActiveHint(close)
  }, [open, close])

  useEffect(() => {
    if (!open) return
    return registerOverlayEscape(close)
  }, [open, close])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const target = e.target
      if (!(target instanceof Node)) return
      if (wrapRef.current?.contains(target)) return
      if (popRef.current?.contains(target)) return
      close()
    }
    // Defer so the opening pointer/click does not immediately dismiss the popover.
    const timer = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown, true)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open, close])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    const raf = window.requestAnimationFrame(() => updatePosition())
    return () => window.cancelAnimationFrame(raf)
  }, [open, updatePosition, children, title])

  useEffect(() => {
    if (!open) return
    function onReposition() {
      updatePosition()
    }
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open, updatePosition])

  if (prefs.data?.hints_enabled === false) return null
  if ((prefs.data?.dismissed ?? []).includes(id)) return null

  const popStyle: CSSProperties = coords
    ? {
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        width: coords.width,
        maxWidth: coords.width,
        visibility: 'visible',
      }
    : { position: 'fixed', visibility: 'hidden', top: 0, left: 0, width: 280 }

  return (
    <span className="hint-wrap" data-testid={`hint-${id}`} ref={wrapRef}>
      <button
        className="hint-btn"
        type="button"
        aria-label={title}
        aria-expanded={open}
        aria-controls={open ? labelId : undefined}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        ?
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popRef}
              id={labelId}
              className="hint-pop"
              role="dialog"
              aria-label={title}
              style={popStyle}
              data-testid={`hint-pop-${id}`}
            >
              <strong>{title}</strong>
              <p>{children}</p>
              <button className="btn btn-ghost btn-compact" type="button" onClick={() => dismiss.mutate()}>
                Больше не показывать
              </button>
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}

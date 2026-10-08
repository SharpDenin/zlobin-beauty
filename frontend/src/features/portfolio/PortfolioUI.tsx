import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Overlay } from '@/shared/ui/Overlay'
import { MediaImage } from '@/shared/ui/MediaImage'
import {
  portfolioDisplayTitle,
  type PortfolioItem,
} from '@/features/portfolio/types'
import '@/features/portfolio/portfolio.css'

type Props = {
  open: boolean
  items: PortfolioItem[]
  index: number
  token?: string | null
  onClose: () => void
  onIndexChange: (index: number) => void
  footer?: ReactNode
}

export function PortfolioViewer({
  open,
  items,
  index,
  token,
  onClose,
  onIndexChange,
  footer,
}: Props) {
  const item = items[index]
  const touchStartX = useRef<number | null>(null)

  const go = useCallback(
    (delta: number) => {
      if (items.length === 0) return
      const next = (index + delta + items.length) % items.length
      onIndexChange(next)
    },
    [index, items.length, onIndexChange],
  )

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        go(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, go])

  if (!item) return null

  const title = portfolioDisplayTitle(item) || 'Работа'

  return (
    <Overlay open={open} onClose={onClose} label={title} closeOnBackdrop={false} className="portfolio-viewer-host">
      <div className="portfolio-viewer" role="document">
        <div className="portfolio-viewer-top">
          <span className="muted">
            {index + 1}/{items.length}
          </span>
          <button type="button" className="btn btn-secondary btn-compact" onClick={onClose} data-overlay-initial-focus>
            Закрыть
          </button>
        </div>
        <div
          className="portfolio-viewer-stage"
          onTouchStart={(e) => {
            touchStartX.current = e.changedTouches[0]?.clientX ?? null
          }}
          onTouchEnd={(e) => {
            const start = touchStartX.current
            touchStartX.current = null
            if (start == null) return
            const dx = (e.changedTouches[0]?.clientX ?? start) - start
            if (Math.abs(dx) < 48) return
            go(dx > 0 ? -1 : 1)
          }}
        >
          {items.length > 1 && (
            <button type="button" className="portfolio-viewer-nav prev" aria-label="Предыдущая" onClick={() => go(-1)}>
              ‹
            </button>
          )}
          <MediaImage mediaId={item.media_id} token={token} alt={title} variant="cover" />
          {items.length > 1 && (
            <button type="button" className="portfolio-viewer-nav next" aria-label="Следующая" onClick={() => go(1)}>
              ›
            </button>
          )}
        </div>
        <div className="portfolio-viewer-bottom">
          <div className="portfolio-viewer-meta">
            <h2>{title}</h2>
            {item.category ? <p>{item.category}</p> : null}
            {item.description ? <p>{item.description}</p> : null}
          </div>
          {footer}
        </div>
      </div>
    </Overlay>
  )
}

type GridProps = {
  items: PortfolioItem[]
  token?: string | null
  onOpen: (index: number) => void
  ownerActions?: {
    onMove: (id: string, direction: 'up' | 'down') => void
  }
  empty?: ReactNode
}

export function PortfolioGrid({ items, token, onOpen, ownerActions, empty }: GridProps) {
  if (items.length === 0) return <>{empty}</>

  return (
    <div className="portfolio-tight-grid" role="list">
      {items.map((item, index) => {
        const title = portfolioDisplayTitle(item) || 'Работа'
        return (
          <button
            key={item.id}
            type="button"
            className="portfolio-cell"
            aria-label={title}
            onClick={() => onOpen(index)}
          >
            <MediaImage mediaId={item.media_id} token={token} alt={title} variant="cover" />
            {ownerActions && (
              <div className="portfolio-cell-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="btn btn-compact"
                  aria-label="Выше"
                  onClick={() => ownerActions.onMove(item.id, 'up')}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-compact"
                  aria-label="Ниже"
                  onClick={() => ownerActions.onMove(item.id, 'down')}
                >
                  ↓
                </button>
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

type ChipsProps = {
  categories: string[]
  value: string
  onChange: (value: string) => void
}

export function PortfolioCategoryChips({ categories, value, onChange }: ChipsProps) {
  const all = ['Все', ...categories]
  return (
    <div className="portfolio-chips" role="toolbar" aria-label="Категории портфолио">
      {all.map((c) => (
        <button
          key={c}
          type="button"
          className={`portfolio-chip ${value === c ? 'is-active' : ''}`}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
        >
          {c}
        </button>
      ))}
    </div>
  )
}

/** Hook-friendly index clamp when the filtered list shrinks. */
export function useClampedIndex(length: number, index: number): number {
  const [safe, setSafe] = useState(index)
  useEffect(() => {
    if (length <= 0) {
      setSafe(0)
      return
    }
    setSafe(Math.min(Math.max(0, index), length - 1))
  }, [length, index])
  return safe
}

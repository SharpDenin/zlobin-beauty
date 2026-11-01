import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { PortfolioGrid, PortfolioViewer } from '@/features/portfolio/PortfolioUI'
import type { PortfolioItem } from '@/features/portfolio/types'

vi.mock('@/shared/lib/mediaCache', () => ({
  getCachedMediaUrl: vi.fn(() => null),
  loadMediaBlobUrl: vi.fn(async (id: string) => `blob:mock/${id}`),
  clearMediaCache: vi.fn(),
}))

// Portfolio grid uses lazy MediaImage; force near-viewport in jsdom.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).IntersectionObserver = class {
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb
    }
    cb: IntersectionObserverCallback
    observe(el: Element) {
      this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
    }
    unobserve() {}
    disconnect() {}
  }
})

vi.mock('@/shared/lib/gifStillFrame', async () => {
  const actual = await vi.importActual<typeof import('@/shared/lib/gifStillFrame')>(
    '@/shared/lib/gifStillFrame',
  )
  return {
    ...actual,
    getCachedGifStill: vi.fn(() => null),
    resolveGifStillFrame: vi.fn(async (mediaId: string) => `data:image/png;base64,STILL_${mediaId}`),
  }
})

function item(partial: Partial<PortfolioItem> & { id: string; media_id: string }): PortfolioItem {
  return {
    master_id: 'm',
    caption: '',
    title: partial.title ?? 'Work',
    description: '',
    category: '',
    media_type: 'photo',
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('PortfolioGrid GIF still frames', () => {
  it('uses still frame for GIF cover layers and leaves photos animated path', async () => {
    const { resolveGifStillFrame } = await import('@/shared/lib/gifStillFrame')
    render(
      <PortfolioGrid
        token="t"
        onOpen={() => undefined}
        items={[
          item({ id: '1', media_id: 'gif-1', media_type: 'gif', title: 'Gif one' }),
          item({ id: '2', media_id: 'jpg-1', media_type: 'photo', title: 'Photo one' }),
          item({ id: '3', media_id: 'gif-2', media_type: 'gif', title: 'Gif two' }),
        ]}
      />,
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Gif one').querySelector('[data-testid="media-still-cover"]')).not.toBeNull()
    })

    const gifCover = screen.getByLabelText('Gif one').querySelector('[data-testid="media-still-cover"]')!
    const imgs = gifCover.querySelectorAll('img')
    expect(imgs).toHaveLength(2)
    expect(imgs[0].getAttribute('src')).toBe('data:image/png;base64,STILL_gif-1')
    expect(imgs[1].getAttribute('src')).toBe('data:image/png;base64,STILL_gif-1')

    const gif2 = screen.getByLabelText('Gif two').querySelector('[data-testid="media-still-cover"]')!
    expect(gif2.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,STILL_gif-2')

    expect(resolveGifStillFrame).toHaveBeenCalledWith('gif-1', 'blob:mock/gif-1')
    expect(resolveGifStillFrame).toHaveBeenCalledWith('gif-2', 'blob:mock/gif-2')
    expect(resolveGifStillFrame).not.toHaveBeenCalledWith('jpg-1', expect.anything())

    const photoCell = screen.getByLabelText('Photo one')
    expect(photoCell.querySelector('[data-testid="media-still-cover"]')).toBeNull()
    await waitFor(() => {
      expect(photoCell.querySelector('img')?.getAttribute('src')).toBe('blob:mock/jpg-1')
    })
  })

  it('falls back to blob when still extraction fails', async () => {
    const { resolveGifStillFrame } = await import('@/shared/lib/gifStillFrame')
    vi.mocked(resolveGifStillFrame).mockResolvedValueOnce(null)
    render(
      <PortfolioGrid
        token="t"
        onOpen={() => undefined}
        items={[item({ id: '1', media_id: 'gif-fail', media_type: 'gif', title: 'Broken gif' })]}
      />,
    )
    await waitFor(() => {
      const imgs = screen.getByLabelText('Broken gif').querySelectorAll('img')
      expect(imgs.length).toBe(2)
      expect(imgs[0].getAttribute('src')).toBe('blob:mock/gif-fail')
      expect(imgs[1].getAttribute('src')).toBe('blob:mock/gif-fail')
    })
  })
})

describe('PortfolioViewer GIF animation', () => {
  it('does not enable stillFrame for GIF detail', async () => {
    const { resolveGifStillFrame } = await import('@/shared/lib/gifStillFrame')
    render(
      <PortfolioViewer
        open
        index={0}
        token="t"
        onClose={() => undefined}
        onIndexChange={() => undefined}
        items={[item({ id: '1', media_id: 'gif-v', media_type: 'gif', title: 'Viewer gif' })]}
      />,
    )
    await waitFor(() => {
      expect(screen.getByRole('document').querySelector('img')?.getAttribute('src')).toBe('blob:mock/gif-v')
    })
    expect(resolveGifStillFrame).not.toHaveBeenCalled()
    expect(screen.getByRole('document').querySelector('[data-testid="media-still-cover"]')).toBeNull()
  })

  it('keeps grid still after opening and closing viewer', async () => {
    const onOpen = vi.fn()
    const { rerender } = render(
      <>
        <PortfolioGrid
          token="t"
          onOpen={onOpen}
          items={[item({ id: '1', media_id: 'gif-1', media_type: 'gif', title: 'Gif one' })]}
        />
        <PortfolioViewer
          open={false}
          index={0}
          token="t"
          onClose={() => undefined}
          onIndexChange={() => undefined}
          items={[item({ id: '1', media_id: 'gif-1', media_type: 'gif', title: 'Gif one' })]}
        />
      </>,
    )
    await waitFor(() => {
      expect(screen.getByLabelText('Gif one').querySelector('[data-testid="media-still-cover"]')).not.toBeNull()
    })
    fireEvent.click(screen.getByLabelText('Gif one'))
    expect(onOpen).toHaveBeenCalled()

    rerender(
      <>
        <PortfolioGrid
          token="t"
          onOpen={onOpen}
          items={[item({ id: '1', media_id: 'gif-1', media_type: 'gif', title: 'Gif one' })]}
        />
        <PortfolioViewer
          open
          index={0}
          token="t"
          onClose={() => undefined}
          onIndexChange={() => undefined}
          items={[item({ id: '1', media_id: 'gif-1', media_type: 'gif', title: 'Gif one' })]}
        />
      </>,
    )
    await waitFor(() => {
      expect(screen.getByRole('document').querySelector('[data-testid="media-still-cover"]')).toBeNull()
    })

    rerender(
      <>
        <PortfolioGrid
          token="t"
          onOpen={onOpen}
          items={[item({ id: '1', media_id: 'gif-1', media_type: 'gif', title: 'Gif one' })]}
        />
        <PortfolioViewer
          open={false}
          index={0}
          token="t"
          onClose={() => undefined}
          onIndexChange={() => undefined}
          items={[item({ id: '1', media_id: 'gif-1', media_type: 'gif', title: 'Gif one' })]}
        />
      </>,
    )
    await waitFor(() => {
      const cover = screen.getByLabelText('Gif one').querySelector('[data-testid="media-still-cover"]')
      expect(cover?.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png/)
    })
  })
})

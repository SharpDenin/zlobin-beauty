import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MediaImage } from '@/shared/ui/MediaImage'
import { ServiceCardMedia } from '@/shared/ui/ServiceCardMedia'
import { MasterPortrait } from '@/shared/ui/MasterPortrait'

vi.mock('@/shared/lib/mediaCache', () => ({
  getCachedMediaUrl: vi.fn(() => null),
  loadMediaBlobUrl: vi.fn(async () => 'blob:mock/default'),
  clearMediaCache: vi.fn(),
}))

vi.mock('@/shared/lib/gifStillFrame', async () => {
  const actual = await vi.importActual<typeof import('@/shared/lib/gifStillFrame')>(
    '@/shared/lib/gifStillFrame',
  )
  return {
    ...actual,
    getCachedGifStill: vi.fn(() => null),
    resolveGifStillFrame: vi.fn(async () => 'data:image/png;base64,STILL'),
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MediaImage fallback', () => {
  it('shows system fallback when media id is missing', () => {
    render(<MediaImage mediaId={null} alt="Стрижка" fallback="СТ" />)
    const el = screen.getByRole('img', { name: 'Стрижка' })
    expect(el).toHaveClass('media-fallback')
    expect(el).toHaveTextContent('СТ')
    expect(el.querySelector('img')).toBeNull()
  })
})

describe('MediaImage stillFrame opt-in', () => {
  it('default path stays animated (no still extraction)', async () => {
    const { resolveGifStillFrame } = await import('@/shared/lib/gifStillFrame')
    render(<MediaImage mediaId="m1" alt="Default" loading="eager" />)
    await waitFor(() => {
      expect(screen.getByAltText('Default').getAttribute('src')).toBe('blob:mock/default')
    })
    expect(resolveGifStillFrame).not.toHaveBeenCalled()
  })

  it('stillFrame uses derived still for plain and both cover layers', async () => {
    const { container: plain } = render(<MediaImage mediaId="g1" alt="Still plain" stillFrame loading="eager" />)
    await waitFor(() => {
      expect(plain.querySelector('[data-testid="media-still"]')?.getAttribute('src')).toBe('data:image/png;base64,STILL')
    })

    const { container: cover } = render(<MediaImage mediaId="g2" alt="Still cover" variant="cover" stillFrame loading="eager" />)
    await waitFor(() => {
      expect(cover.querySelector('[data-testid="media-still-cover"]')).not.toBeNull()
    })
    const imgs = cover.querySelectorAll('[data-testid="media-still-cover"] img')
    expect(imgs).toHaveLength(2)
    expect(imgs[0].getAttribute('src')).toBe('data:image/png;base64,STILL')
    expect(imgs[1].getAttribute('src')).toBe('data:image/png;base64,STILL')
  })

  it('does not leave stale still after unmount during resolve', async () => {
    const { resolveGifStillFrame } = await import('@/shared/lib/gifStillFrame')
    let release: ((v: string | null) => void) | undefined
    vi.mocked(resolveGifStillFrame).mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve }),
    )
    const { unmount } = render(<MediaImage mediaId="slow" alt="Slow" stillFrame loading="eager" />)
    await waitFor(() => expect(release).toBeTypeOf('function'))
    unmount()
    const finish = release
    expect(finish).toBeDefined()
    finish!('data:image/png;base64,LATE')
    await Promise.resolve()
    expect(document.querySelector('[data-testid="media-still"]')).toBeNull()
  })
})

describe('ServiceCardMedia', () => {
  it('uses landscape frame and fallback for a service without photo', () => {
    const { container } = render(<ServiceCardMedia name="Окрашивание" mediaId={null} />)
    expect(container.querySelector('.media-frame--landscape')).not.toBeNull()
    expect(container.querySelector('.media-first-cover--landscape')).not.toBeNull()
    expect(screen.getByRole('img', { name: 'Окрашивание' })).toHaveClass('media-fallback')
    expect(screen.getByRole('img', { name: 'Окрашивание' })).toHaveTextContent('ОК')
  })

  it('keeps overlay text out of the cover when overlay is omitted (edge catalog cards)', () => {
    const { container } = render(<ServiceCardMedia name="Стрижка" mediaId={null} aspect="square" />)
    expect(container.querySelector('.media-first-overlay')).toBeNull()
    expect(container.querySelector('.media-first-cover--square')).not.toBeNull()
  })

  it('renders overlay only when explicitly requested (hero/search cards)', () => {
    const { container } = render(
      <ServiceCardMedia
        name="Анна"
        mediaId={null}
        aspect="hero"
        overlay={{ title: 'Анна', meta: '★ 4.9' }}
      />,
    )
    expect(container.querySelector('.media-first-overlay')).not.toBeNull()
    expect(container.querySelector('.media-first-overlay strong')).toHaveTextContent('Анна')
  })
})

describe('MasterPortrait', () => {
  it('uses initials fallback when portrait is absent', () => {
    render(<MasterPortrait name="Анна Иванова" mediaId={null} />)
    expect(screen.getByRole('img', { name: 'Анна Иванова' })).toHaveTextContent('АИ')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({
  getFreshAccessToken: vi.fn(async () => 'fresh-token'),
  refreshAccessToken: vi.fn(async () => 'refreshed-token'),
}))

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>()
  return { ...actual, ...client }
})

import {
  detectMime,
  mediaFileApiError,
  mediaKindOf,
  scaledSize,
  shouldCompress,
  uploadMedia,
} from '@/shared/lib/mediaUpload'

function file(type: string, size: number, name = 'f') {
  const blob = new Blob([new Uint8Array(size)], { type })
  return new File([blob], name, { type })
}

describe('mediaFileApiError', () => {
  it('maps empty, type and size to typed codes', () => {
    expect(mediaFileApiError(file('image/jpeg', 0))?.code).toBe('media_empty')
    expect(mediaFileApiError(file('application/pdf', 12))?.code).toBe('media_unsupported_type')
    expect(mediaFileApiError(file('image/jpeg', 12))).toBeNull()
  })

  it('lets big camera photos through: they are shrunk before sending', () => {
    expect(mediaFileApiError(file('image/jpeg', 9 * 1024 * 1024))).toBeNull()
    expect(mediaFileApiError(file('image/jpeg', 70 * 1024 * 1024))?.code).toBe('media_too_large')
  })

  it('requires explicit permission for video and keeps the video ceiling', () => {
    expect(mediaFileApiError(file('video/mp4', 1024))?.code).toBe('media_unsupported_type')
    expect(mediaFileApiError(file('video/mp4', 1024), { allowVideo: true })).toBeNull()
    const tooBig = mediaFileApiError(file('video/mp4', 51 * 1024 * 1024), { allowVideo: true })
    expect(tooBig?.code).toBe('media_too_large')
    expect(tooBig?.details?.max_bytes).toBe(50 * 1024 * 1024)
  })

  it('accepts GIF unless a screen forbids it, and caps it at the image ceiling', () => {
    expect(mediaFileApiError(file('image/gif', 1024))).toBeNull()
    expect(mediaFileApiError(file('image/gif', 1024), { allowGif: false })?.code).toBe('media_unsupported_type')
    expect(mediaFileApiError(file('image/gif', 11 * 1024 * 1024))?.code).toBe('media_too_large')
  })
})

describe('type detection', () => {
  it('falls back to the extension when the browser leaves file.type empty', () => {
    expect(detectMime({ type: '', name: 'IMG_0001.JPG' })).toBe('image/jpeg')
    expect(detectMime({ type: '', name: 'clip.mov' })).toBe('video/quicktime')
    expect(detectMime({ type: 'application/octet-stream', name: 'a.webp' })).toBe('image/webp')
    expect(detectMime({ type: 'image/jpg', name: 'x' })).toBe('image/jpeg')
    expect(mediaKindOf({ type: '', name: 'anim.gif' })).toBe('gif')
    expect(mediaKindOf({ type: '', name: 'doc.pdf' })).toBeNull()
  })
})

describe('photo preparation', () => {
  it('only re-encodes large still photos', () => {
    expect(shouldCompress(file('image/jpeg', 300 * 1024))).toBe(false)
    expect(shouldCompress(file('image/jpeg', 3 * 1024 * 1024))).toBe(true)
    expect(shouldCompress(file('image/gif', 8 * 1024 * 1024))).toBe(false)
    expect(shouldCompress(file('video/mp4', 8 * 1024 * 1024))).toBe(false)
  })

  it('scales the long edge down and never up', () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 2560, height: 1920 })
    expect(scaledSize(3000, 4000)).toEqual({ width: 1920, height: 2560 })
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 })
  })
})

type FakeResponse = { status: number; body: string }

class FakeXhr {
  static queue: FakeResponse[] = []
  static sent: Array<{ auth: string | null; purpose: unknown }> = []
  upload: { onprogress: ((ev: unknown) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  status = 0
  responseText = ''
  timeout = -1
  private auth: string | null = null
  open() {}
  setRequestHeader(name: string, value: string) {
    if (name === 'Authorization') this.auth = value
  }
  abort() {
    this.onabort?.()
  }
  send(form: FormData) {
    FakeXhr.sent.push({ auth: this.auth, purpose: form.get('purpose') })
    const next = FakeXhr.queue.shift() ?? { status: 0, body: '' }
    queueMicrotask(() => {
      if (next.status === 0) {
        this.onerror?.()
        return
      }
      this.status = next.status
      this.responseText = next.body
      this.onload?.()
    })
  }
}

describe('uploadMedia', () => {
  beforeEach(() => {
    FakeXhr.queue = []
    FakeXhr.sent = []
    client.getFreshAccessToken.mockClear()
    client.refreshAccessToken.mockClear()
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends a fresh token (not the possibly stale one the caller holds) and the purpose', async () => {
    FakeXhr.queue.push({ status: 201, body: JSON.stringify({ id: 'm1', content_type: 'image/jpeg' }) })
    const res = await uploadMedia(file('image/jpeg', 2048), 'portfolio', 'stale-token')
    expect(res.id).toBe('m1')
    expect(FakeXhr.sent[0]).toEqual({ auth: 'Bearer fresh-token', purpose: 'portfolio' })
  })

  it('refreshes once and retries when the server answers 401', async () => {
    FakeXhr.queue.push({ status: 401, body: JSON.stringify({ error: { code: 'session_expired', message: 'session expired' } }) })
    FakeXhr.queue.push({ status: 201, body: JSON.stringify({ id: 'm2' }) })
    const res = await uploadMedia(file('image/png', 2048), 'profile', null)
    expect(res.id).toBe('m2')
    expect(client.refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(FakeXhr.sent.map((s) => s.auth)).toEqual(['Bearer fresh-token', 'Bearer refreshed-token'])
  })

  it('maps a proxy 413 without a JSON body to media_too_large', async () => {
    FakeXhr.queue.push({ status: 413, body: '<html>Request Entity Too Large</html>' })
    await expect(uploadMedia(file('image/jpeg', 2048), 'profile', null)).rejects.toMatchObject({ code: 'media_too_large' })
  })

  it('maps an empty 502 from the edge to a typed "service unavailable" error, not a network error', async () => {
    FakeXhr.queue.push({ status: 502, body: '' })
    await expect(uploadMedia(file('image/jpeg', 2048), 'profile', null)).rejects.toMatchObject({ code: 'upstream_unavailable' })
  })

  it('reports a dropped connection as a network error', async () => {
    FakeXhr.queue.push({ status: 0, body: '' })
    await expect(uploadMedia(file('image/jpeg', 2048), 'profile', null)).rejects.toMatchObject({ code: 'network_error' })
  })

  it('routes video to purpose=video and rejects it when the screen does not allow video', async () => {
    await expect(uploadMedia(file('video/mp4', 4096), 'profile', null)).rejects.toMatchObject({ code: 'media_unsupported_type' })
    FakeXhr.queue.push({ status: 201, body: JSON.stringify({ id: 'v1', content_type: 'video/mp4' }) })
    await uploadMedia(file('video/mp4', 4096), 'portfolio', null, undefined, { allowVideo: true })
    expect(FakeXhr.sent.at(-1)?.purpose).toBe('video')
  })

  it('keeps purpose=message for chat attachments of any kind', async () => {
    FakeXhr.queue.push({ status: 201, body: JSON.stringify({ id: 'v2' }) })
    await uploadMedia(file('video/mp4', 4096), 'message', null)
    expect(FakeXhr.sent.at(-1)?.purpose).toBe('message')
  })
})

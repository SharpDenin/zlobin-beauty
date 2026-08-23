import { describe, expect, it } from 'vitest'
import { sanitizeHref, sanitizeMediaSrc } from './richSanitize'

describe('sanitizeHref', () => {
  it('allows http(s), mailto and relative paths', () => {
    expect(sanitizeHref('https://example.com/a')).toBe('https://example.com/a')
    expect(sanitizeHref('http://example.com')).toBe('http://example.com')
    expect(sanitizeHref('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(sanitizeHref('/knowledge')).toBe('/knowledge')
  })

  it('rejects javascript and data URLs', () => {
    expect(sanitizeHref('javascript:alert(1)')).toBeNull()
    expect(sanitizeHref('DATA:text/html,<script>alert(1)</script>')).toBeNull()
    expect(sanitizeHref('vbscript:msgbox')).toBeNull()
    expect(sanitizeHref('alert(1)')).toBeNull()
  })
})

describe('sanitizeMediaSrc', () => {
  it('rejects script-like sources', () => {
    expect(sanitizeMediaSrc('javascript:void(0)')).toBeNull()
    expect(sanitizeMediaSrc('data:image/svg+xml,<svg>')).toBeNull()
  })

  it('allows media API paths', () => {
    expect(sanitizeMediaSrc('/v1/media/abc/content')).toBe('/v1/media/abc/content')
  })
})

describe('seed-like article node order', () => {
  it('keeps paragraph, image, paragraph, video, tip sequence', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph' },
        { type: 'image', attrs: { src: '/v1/media/1/content' } },
        { type: 'paragraph' },
        { type: 'video', attrs: { src: '/v1/media/2/content' } },
        { type: 'callout', attrs: { kind: 'tip' } },
      ],
    }
    expect(doc.content.map((n) => n.type)).toEqual(['paragraph', 'image', 'paragraph', 'video', 'callout'])
  })
})

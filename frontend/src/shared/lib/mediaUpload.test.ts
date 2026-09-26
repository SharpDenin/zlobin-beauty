import { describe, expect, it } from 'vitest'
import { mediaFileApiError } from '@/shared/lib/mediaUpload'

function file(type: string, size: number) {
  const blob = new Blob([new Uint8Array(size)], { type })
  return new File([blob], 'f', { type })
}

describe('mediaFileApiError', () => {
  it('maps empty, type and size to PHASE 5 codes', () => {
    expect(mediaFileApiError(file('image/jpeg', 0))?.code).toBe('media_empty')
    expect(mediaFileApiError(file('application/pdf', 12))?.code).toBe('media_unsupported_type')
    expect(mediaFileApiError(file('image/jpeg', 6 * 1024 * 1024))?.code).toBe('media_too_large')
    expect(mediaFileApiError(file('image/jpeg', 12))).toBeNull()
  })
})

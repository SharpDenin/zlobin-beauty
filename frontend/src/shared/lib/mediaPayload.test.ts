import { describe, expect, it } from 'vitest'
import { photoMediaIdForCreate, photoMediaIdForPatch } from './mediaPayload'

describe('service photo payload', () => {
  it('omits photo on create when absent', () => {
    expect(photoMediaIdForCreate(null)).toBeUndefined()
    expect(photoMediaIdForCreate(undefined)).toBeUndefined()
    expect(photoMediaIdForCreate('')).toBeUndefined()
    expect(photoMediaIdForCreate('  ')).toBeUndefined()
  })

  it('sends media id on create when present', () => {
    expect(photoMediaIdForCreate('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    )
  })

  it('clears photo on patch with empty string', () => {
    expect(photoMediaIdForPatch(null)).toBe('')
    expect(photoMediaIdForPatch(undefined)).toBe('')
  })

  it('keeps media id on patch when present', () => {
    expect(photoMediaIdForPatch('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    )
  })
})

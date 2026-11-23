import { describe, expect, it } from 'vitest'
import { ownerMasterIdsForBranch } from '@/pages/calendar-owner-masters'

describe('ownerMasterIdsForBranch', () => {
  it('keeps only masters whose branch_id matches', () => {
    const ids = ['a', 'b', 'c']
    const map = { a: 'br1', b: 'br2', c: 'br1' }
    expect(ownerMasterIdsForBranch(ids, 'br1', map)).toEqual(['a', 'c'])
  })

  it('excludes unknown and empty branch ids (no temporary leak)', () => {
    const ids = ['a', 'b', 'c']
    const map = { a: 'br1', b: '', c: undefined }
    expect(ownerMasterIdsForBranch(ids, 'br1', map)).toEqual(['a'])
  })

  it('returns empty when branch is unset', () => {
    expect(ownerMasterIdsForBranch(['a'], '', { a: 'br1' })).toEqual([])
  })
})

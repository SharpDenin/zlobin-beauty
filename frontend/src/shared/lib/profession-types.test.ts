import { describe, expect, it } from 'vitest'
import { masterProfessionLabel, selectedProfessionIds } from './profession-types'

describe('masterProfessionLabel', () => {
  it('prefers profession types over specializations', () => {
    expect(masterProfessionLabel({
      profession_types: [{ id: '1', slug: 'colorist', name: 'Колорист' }],
      specializations: ['колористика', 'стрижки'],
    })).toBe('Колорист')
  })

  it('falls back to specializations when types are missing', () => {
    expect(masterProfessionLabel({ specializations: ['стрижки'] })).toBe('стрижки')
  })
})

describe('selectedProfessionIds', () => {
  it('returns assigned ids', () => {
    expect(selectedProfessionIds({
      profession_types: [{ id: 'aaa', slug: 'hairdresser', name: 'Парикмахер' }],
    })).toEqual(['aaa'])
  })
})

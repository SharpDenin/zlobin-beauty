import { describe, expect, it } from 'vitest'
import { branchLabel } from '@/shared/lib/branch-label'

describe('branchLabel', () => {
  it('keeps a unique branch name', () => {
    const branches = [
      { id: '1', name: 'Красноярск, Мира', city: 'Красноярск', address_line: 'ул. Мира, 10' },
      { id: '2', name: 'Новосибирск', city: 'Новосибирск', address_line: 'Красный проспект, 1' },
    ]
    expect(branchLabel(branches[1], branches)).toBe('Новосибирск')
  })

  it('does not merge different salons that share a city', () => {
    const branches = [
      { id: '1', name: 'Новосибирск', city: 'Новосибирск', address_line: 'Красный проспект, 1' },
      { id: '2', name: 'Новосибирск', city: 'Новосибирск', address_line: 'ул. Ленина, 8' },
    ]
    expect(branchLabel(branches[0], branches)).toBe('Новосибирск · Красный проспект, 1')
    expect(branchLabel(branches[1], branches)).toBe('Новосибирск · ул. Ленина, 8')
    expect(branchLabel(branches[0], branches)).not.toBe(branchLabel(branches[1], branches))
  })
})

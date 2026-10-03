import { describe, expect, it } from 'vitest'
import { assertProductionApiBase, productionApiBaseRejected } from './production-api-base'

describe('productionApiBaseRejected', () => {
  it('allows empty same-origin and a public origin', () => {
    expect(productionApiBaseRejected(undefined)).toBe(false)
    expect(productionApiBaseRejected('')).toBe(false)
    expect(productionApiBaseRejected('https://api.example.com')).toBe(false)
  })

  it('rejects loopback API hosts', () => {
    expect(productionApiBaseRejected('http://localhost:8090')).toBe(true)
    expect(productionApiBaseRejected('http://127.0.0.1:8090')).toBe(true)
  })
})

describe('assertProductionApiBase', () => {
  it('does not throw in development even with localhost', () => {
    expect(() => assertProductionApiBase('http://localhost:8090', 'development')).not.toThrow()
  })

  it('throws in production when the API base is loopback', () => {
    expect(() => assertProductionApiBase('http://localhost:8090', 'production')).toThrow(/localhost API URL/)
  })
})

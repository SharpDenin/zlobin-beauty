import { describe, expect, it } from 'vitest'
import { hasColorFormulaInput, schemeSummaryState } from './visit-visibility'

describe('hasColorFormulaInput', () => {
  it('requires formula fields or a product, not technique alone', () => {
    expect(hasColorFormulaInput({ technique: 'балаяж' })).toBe(false)
    expect(hasColorFormulaInput({ dye: 'Majirel 7.1' })).toBe(true)
    expect(hasColorFormulaInput({}, 'Majirel 7.1')).toBe(true)
  })
})

describe('schemeSummaryState', () => {
  it('keeps skip and omit independent', () => {
    const skipOnly = schemeSummaryState({ skipped: true, details_redacted: true, formula_redacted: false })
    expect(skipOnly.showSchemeWithheld).toBe(true)
    expect(skipOnly.showFormulaBody).toBe(true)

    const omitOnly = schemeSummaryState({ skipped: false, details_redacted: false, formula_redacted: true })
    expect(omitOnly.showSchemeBody).toBe(true)
    expect(omitOnly.showFormulaWithheld).toBe(true)
  })

  it('does not hide an owner payload just because skipped is true', () => {
    const owner = schemeSummaryState({ skipped: true, details_redacted: false, formula_redacted: false })
    expect(owner.showSchemeBody).toBe(true)
    expect(owner.showFormulaBody).toBe(true)
  })
})

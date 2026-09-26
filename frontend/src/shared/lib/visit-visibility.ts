export const FORMULA_FIELD_KEYS = ['formula', 'dye', 'shades', 'proportions', 'oxidizer'] as const

export function hasColorFormulaInput(fields: Record<string, string>, productName = ''): boolean {
  if (productName.trim()) return true
  return FORMULA_FIELD_KEYS.some((key) => Boolean(fields[key]?.trim()))
}

export function schemeSummaryState(payload: {
  skipped?: boolean
  details_redacted?: boolean
  formula_redacted?: boolean
}) {
  const detailsRedacted = Boolean(payload.details_redacted)
  const formulaRedacted = Boolean(payload.formula_redacted)
  return {
    showSchemeWithheld: detailsRedacted,
    showFormulaWithheld: formulaRedacted,
    showSchemeBody: !detailsRedacted,
    showFormulaBody: !formulaRedacted,
  }
}

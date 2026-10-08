import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { FORMULA_FIELD_KEYS, schemeSummaryState } from '@/shared/lib/visit-visibility'

type SchemePayload = {
  exists: boolean
  skipped?: boolean
  omit_formula?: boolean
  details_redacted?: boolean
  formula_redacted?: boolean
  technique?: string
  notes?: string
  category_fields?: Record<string, unknown>
  components?: Array<{ name: string; brand?: string; qty?: string; proportion?: string }>
}

const SCHEME_LABELS: Record<string, string> = {
  technique: 'Техника',
  dye: 'Краситель',
  shades: 'Оттенки',
  proportions: 'Пропорции',
  oxidizer: 'Окислитель',
  formula: 'Формула',
  product: 'Продукт',
  notes: 'Заметки',
}

function schemeLabel(key: string) {
  return SCHEME_LABELS[key] ?? key
}

const FORMULA_KEY_SET = new Set<string>(FORMULA_FIELD_KEYS)

export function VisitSchemeSummary({
  appointmentId,
  accessToken,
}: {
  appointmentId: string
  accessToken: string | null
}) {
  const scheme = useQuery({
    queryKey: ['visit-scheme', appointmentId],
    queryFn: () => apiRequest<SchemePayload>(`/v1/appointments/${appointmentId}/scheme`, { token: accessToken }),
    enabled: Boolean(appointmentId && accessToken),
    retry: false,
  })

  if (scheme.isLoading) {
    return <p className="muted">Схема услуги…</p>
  }
  if (!scheme.data?.exists) {
    return null
  }

  const ui = schemeSummaryState(scheme.data)
  const fields = scheme.data.category_fields ?? {}
  const schemeEntries = Object.entries(fields).filter(([key, v]) => !FORMULA_KEY_SET.has(key) && String(v).trim() !== '')
  const formulaEntries = Object.entries(fields).filter(([key, v]) => FORMULA_KEY_SET.has(key) && String(v).trim() !== '')
  const comps = scheme.data.components ?? []

  return (
    <div className="stack-sm scheme-summary" data-testid="scheme-summary">
      {scheme.data.skipped && !ui.showSchemeWithheld && (
        <p className="muted">Схема скрыта от других мастеров</p>
      )}
      {scheme.data.omit_formula && !ui.showFormulaWithheld && (
        <p className="muted">Формула скрыта от других мастеров</p>
      )}
      {ui.showSchemeWithheld && (
        <p className="muted scheme-withheld" data-testid="scheme-withheld">
          Схема не раскрыта
        </p>
      )}
      {ui.showFormulaWithheld && (
        <p className="muted formula-withheld" data-testid="formula-withheld">
          Формула не указана
        </p>
      )}
      {ui.showSchemeBody && (
        <>
          {scheme.data.technique && (
            <p>
              <span className="muted">Техника: </span>
              {scheme.data.technique}
            </p>
          )}
          {schemeEntries.map(([key, value]) => (
            <p key={key}>
              <span className="muted">{schemeLabel(key)}: </span>
              {String(value)}
            </p>
          ))}
          {scheme.data.notes && (
            <p>
              <span className="muted">Заметки: </span>
              {scheme.data.notes}
            </p>
          )}
        </>
      )}
      {ui.showFormulaBody && (
        <>
          {formulaEntries.map(([key, value]) => (
            <p key={key} data-testid="formula-field">
              <span className="muted">{schemeLabel(key)}: </span>
              {String(value)}
            </p>
          ))}
          {comps.map((c) => (
            <p key={c.name}>
              <span className="muted">Материал: </span>
              {[c.name, c.qty, c.proportion].filter(Boolean).join(' · ')}
            </p>
          ))}
        </>
      )}
    </div>
  )
}

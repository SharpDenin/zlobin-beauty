import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'

type SchemePayload = {
  exists: boolean
  skipped?: boolean
  technique?: string
  notes?: string
  category_fields?: Record<string, unknown>
  components?: Array<{ name: string; brand?: string; qty?: string; proportion?: string }>
  template_version?: number
}

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
  if (scheme.data.skipped) {
    return (
      <p className="muted scheme-withheld" data-testid="scheme-withheld">
        Схема не раскрыта мастером
      </p>
    )
  }

  const fields = scheme.data.category_fields ?? {}
  const entries = Object.entries(fields).filter(([, v]) => String(v).trim() !== '')
  const comps = scheme.data.components ?? []

  return (
    <div className="stack-sm scheme-summary" data-testid="scheme-summary">
      {scheme.data.technique && (
        <p>
          <span className="muted">Техника: </span>
          {scheme.data.technique}
        </p>
      )}
      {entries.map(([key, value]) => (
        <p key={key}>
          <span className="muted">{key}: </span>
          {String(value)}
        </p>
      ))}
      {comps.map((c) => (
        <p key={c.name}>
          <span className="muted">Материал: </span>
          {[c.name, c.qty, c.proportion].filter(Boolean).join(' · ')}
        </p>
      ))}
      {scheme.data.notes && (
        <p>
          <span className="muted">Заметки: </span>
          {scheme.data.notes}
        </p>
      )}
    </div>
  )
}

import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import {
  emptyRecommendationMessage,
  knowledgeServiceQuery,
  recommendationContextLabel,
  type KnowledgeRecommendResponse,
} from '@/pages/knowledge-helpers'

export function KnowledgeRecommendations({
  token,
  serviceId,
  organizationId,
  appointmentId,
  productIds,
  title = 'База знаний',
  emptyKind = 'generic',
}: {
  token: string | null
  serviceId?: string
  organizationId?: string
  appointmentId?: string
  productIds?: string[]
  title?: string
  emptyKind?: 'product' | 'service' | 'generic'
}) {
  const enabled = Boolean(token && (serviceId || organizationId || appointmentId || (productIds && productIds.length > 0)))
  const query = useQuery({
    queryKey: ['knowledge-recommendations', serviceId, organizationId, appointmentId, productIds],
    queryFn: () =>
      apiRequest<KnowledgeRecommendResponse>(
        knowledgeServiceQuery({ serviceId, organizationId, appointmentId, productIds }),
        { token },
      ),
    enabled,
  })

  if (!enabled) return null

  return (
    <section className="stack" data-testid="knowledge-recommendations">
      <h3>{title}</h3>
      {query.isLoading && <p className="muted">Ищем сохранённые материалы…</p>}
      {query.isError && <ErrorBanner error={query.error} fallbackTitle="Не удалось загрузить базу знаний" />}
      {query.data && query.data.items.length === 0 && (
        <p className="muted" data-testid="knowledge-empty">
          {emptyRecommendationMessage(query.data.empty_reason, emptyKind)}
        </p>
      )}
      {query.data && query.data.items.length > 0 && (
        <div className="list">
          {query.data.items.map((it) => (
            <article key={it.id} className="history-card" data-testid="knowledge-recommendation">
              <div className="row between">
                <strong>{it.title}</strong>
                {it.context && <span className="badge">{recommendationContextLabel(it.context)}</span>}
              </div>
              {it.excerpt && <p className="muted">{it.excerpt}</p>}
              <Link className="btn btn-secondary btn-compact" to={`/knowledge/${it.id}`} data-testid="knowledge-open">
                Открыть
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

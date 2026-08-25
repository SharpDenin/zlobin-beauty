import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { AvailabilityPanel } from '@/pages/AvailabilityPanel'
import { KnowledgeRecommendations } from '@/pages/KnowledgeRecommendations'
import { availabilityBadgeClass, availabilityStatusMark, type AvailabilityAnalysis } from '@/pages/availability-helpers'

export function CalendarAvailability({
  token,
  organizationId,
  serviceId,
  appointmentId,
}: {
  token: string | null
  organizationId: string
  serviceId: string
  appointmentId?: string
}) {
  const [open, setOpen] = useState(false)
  const query = useQuery({
    queryKey: ['inventory-availability', organizationId, serviceId, appointmentId],
    queryFn: () => {
      const qs = new URLSearchParams({ organization_id: organizationId, service_id: serviceId })
      if (appointmentId) qs.set('appointment_id', appointmentId)
      return apiRequest<AvailabilityAnalysis>(`/v1/me/inventory/availability?${qs.toString()}`, { token })
    },
    enabled: open && Boolean(token && organizationId && serviceId),
  })

  return (
    <section className="stack" data-testid="availability-calendar">
      <div className="row">
        <button
          className="btn btn-secondary btn-compact"
          type="button"
          data-testid="availability-indicator"
          onClick={() => setOpen((v) => !v)}
        >
          ! Наличие материалов
        </button>
        {query.data && (
          <span className={`badge ${availabilityBadgeClass(query.data.availability_status || (query.data.can_perform_now ? 'available' : 'shortage'))}`}>
            {availabilityStatusMark(query.data.availability_status || (query.data.can_perform_now ? 'available' : 'shortage'))}
          </span>
        )}
      </div>
      {open && query.isLoading && <p className="muted">Проверяем склад…</p>}
      {open && query.isError && <div className="state-box error">Не удалось проверить наличие</div>}
      {open && query.data && <AvailabilityPanel analysis={query.data} />}
      <KnowledgeRecommendations
        token={token}
        serviceId={serviceId}
        organizationId={organizationId}
        appointmentId={appointmentId}
        productIds={query.data?.items.map((it) => it.product_id)}
        title="База знаний по услуге"
        emptyKind="service"
      />
    </section>
  )
}

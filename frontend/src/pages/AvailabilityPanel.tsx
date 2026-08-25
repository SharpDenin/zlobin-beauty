import { Link } from 'react-router-dom'
import {
  alternativeMessage,
  availabilityBadgeClass,
  availabilityStatusLabel,
  availabilityStatusMark,
  cosmeticsProductPath,
  itemAvailable,
  itemIncoming,
  itemShortage,
  overallAvailabilityMessage,
  showOrderCta,
  type AvailabilityAnalysis,
  type AvailabilityItem,
} from '@/pages/availability-helpers'

function unit(it: AvailabilityItem) {
  return it.unit ? ` ${it.unit}` : ''
}

function productTitle(it: AvailabilityItem) {
  return [it.brand, it.product_name].filter(Boolean).join(' ') || 'Материал'
}

export function AvailabilityPanel({
  analysis,
  compact = false,
}: {
  analysis: AvailabilityAnalysis
  compact?: boolean
}) {
  return (
    <div className="stack" data-testid="availability-panel">
      <p data-testid="availability-summary">
        {overallAvailabilityMessage(analysis.availability_status, analysis.can_perform_now)}
      </p>
      <div className="list">
        {analysis.items.map((it) => (
          <article key={it.product_id} className="history-card" data-testid="availability-item" data-status={it.status}>
            <div className="row between">
              <strong>{productTitle(it)}</strong>
              <span className={`badge ${availabilityBadgeClass(it.status)}`}>
                {availabilityStatusMark(it.status)} {availabilityStatusLabel(it.status)}
              </span>
            </div>
            <p className="muted">
              Нужно {it.required_qty}{unit(it)} · Есть {itemAvailable(it)}{unit(it)} · В пути {itemIncoming(it)}{unit(it)}
              {itemShortage(it) > 0 ? ` · Не хватает ${itemShortage(it)}${unit(it)}` : ''}
            </p>
            {it.status === 'incoming' && (
              <p className="muted">После поставки хватит. Поставка ещё не на складе.</p>
            )}
            {showOrderCta(it) && (
              <Link className="btn btn-secondary btn-compact" to={cosmeticsProductPath(it.product_id)} data-testid="availability-order">
                Заказать
              </Link>
            )}
          </article>
        ))}
      </div>
      {analysis.items.length === 0 && <p className="muted">Норм расхода для услуги нет</p>}
      {!compact && !analysis.can_perform_now && analysis.alternative && (
        <p className="muted" data-testid="availability-alternative">{alternativeMessage(analysis.alternative)}</p>
      )}
    </div>
  )
}

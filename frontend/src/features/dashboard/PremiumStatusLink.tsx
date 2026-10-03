import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { premiumHeaderState, type SubscriptionSnapshot } from '@/features/dashboard/premiumLabel'

type Props = {
  className?: string
  compact?: boolean
}

export function PremiumStatusLink({ className = '', compact = false }: Props) {
  const { accessToken } = useAuth()
  const sub = useQuery({
    queryKey: ['me-subscription'],
    queryFn: () => apiRequest<SubscriptionSnapshot>('/v1/me/subscription', { token: accessToken }),
    enabled: Boolean(accessToken),
    staleTime: 60_000,
  })
  const state = premiumHeaderState(sub.data)
  const classes = [
    'premium-status',
    state.active ? 'premium-status--active' : 'premium-status--inactive',
    compact ? 'premium-status--compact' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Link
      to="/profile/subscription"
      className={classes}
      data-testid="premium-status-link"
      aria-label={state.active ? `Подписка ${state.label}` : 'Подключить Premium'}
    >
      <span className="premium-status__mark" aria-hidden="true">✦</span>
      <span className="premium-status__label">{state.label}</span>
      {state.detail ? <span className="premium-status__detail">{state.detail}</span> : null}
    </Link>
  )
}

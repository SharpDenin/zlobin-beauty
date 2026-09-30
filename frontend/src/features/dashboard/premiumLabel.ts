export type SubscriptionSnapshot = {
  status?: string
  trial_ends_at?: string
  effective_plan?: string
}

/** Calm premium status pill copy for hero / profile. */
export function premiumLabel(sub: SubscriptionSnapshot | null | undefined): string {
  if (!sub) return 'Free'
  if (sub.status === 'trial' && sub.trial_ends_at) {
    return `Пробный период до ${new Date(sub.trial_ends_at).toLocaleDateString('ru-RU')}`
  }
  if (sub.effective_plan === 'premium') return 'Premium'
  return 'Free'
}

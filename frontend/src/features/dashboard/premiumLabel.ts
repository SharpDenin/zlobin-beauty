export type SubscriptionSnapshot = {
  status?: string
  trial_ends_at?: string
  effective_plan?: string
}

export type PremiumHeaderState = {
  active: boolean
  label: string
  detail?: string
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

/** Compact header / sidenav status — navigates to /profile/subscription. */
export function premiumHeaderState(sub: SubscriptionSnapshot | null | undefined): PremiumHeaderState {
  if (!sub) return { active: false, label: 'Premium', detail: 'Подключить' }
  if (sub.status === 'trial' && sub.trial_ends_at) {
    return {
      active: true,
      label: 'Premium',
      detail: `до ${new Date(sub.trial_ends_at).toLocaleDateString('ru-RU')}`,
    }
  }
  if (sub.effective_plan === 'premium') {
    return { active: true, label: 'Premium' }
  }
  return { active: false, label: 'Premium', detail: 'Подключить' }
}

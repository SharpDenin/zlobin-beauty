import { DevicePushCard } from '@/features/pwa/DevicePushCard'

export function SettingsNotificationsPage() {
  return (
    <div className="stack" data-testid="settings-notifications-page">
      <p className="muted">
        Системные push не заменяют ленту в приложении. Включение запрашивает разрешение только после вашего действия.
      </p>
      <DevicePushCard />
    </div>
  )
}

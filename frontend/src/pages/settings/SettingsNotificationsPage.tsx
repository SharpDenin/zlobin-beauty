import { Link } from 'react-router-dom'
import { DevicePushCard } from '@/features/pwa/DevicePushCard'

export function SettingsNotificationsPage() {
  return (
    <div className="stack" data-testid="settings-notifications-page">
      <section className="card stack">
        <h2 style={{ margin: 0 }}>Лента в приложении</h2>
        <p className="muted">
          Записи, напоминания и системные события — в общей ленте. Счётчики непрочитанных сообщений
          мессенджера остаются в чатах и не зависят от этих настроек.
        </p>
        <Link className="btn btn-secondary" to="/notifications">
          Открыть уведомления
        </Link>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Push на устройстве</h2>
        <p className="muted">
          Системные push не заменяют ленту в приложении. Включение запрашивает разрешение только после вашего действия.
        </p>
        <DevicePushCard />
      </section>
    </div>
  )
}

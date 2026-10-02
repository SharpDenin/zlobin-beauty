import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { formatMoney } from '@/shared/lib/money'
import { statusBadgeClass, statusLabel } from '@/shared/lib/status'

export type AppointmentTone = 'waiting' | 'live' | 'upcoming' | 'done' | 'cancelled'

export function appointmentTone(status: string): AppointmentTone {
  if (status.startsWith('cancelled') || status === 'no_show') return 'cancelled'
  if (status === 'completed') return 'done'
  if (status === 'in_progress') return 'live'
  if (status === 'pending_confirmation') return 'waiting'
  return 'upcoming'
}

function formatWhen(iso: string) {
  const at = new Date(iso)
  return {
    time: at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    date: at.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }),
  }
}

export function AppointmentCard({
  to,
  serviceName,
  status,
  startsAt,
  priceMinor,
  subtitle,
  personName,
  personInitials,
  actions,
}: {
  to?: string
  serviceName: string
  status: string
  startsAt: string
  priceMinor?: number
  subtitle?: string
  personName?: string
  personInitials?: string
  actions?: ReactNode
}) {
  const tone = appointmentTone(status)
  const when = formatWhen(startsAt)
  const title = personName?.trim() || serviceName
  const sub = personName?.trim()
    ? [serviceName, subtitle].filter(Boolean).join(' · ')
    : subtitle
  const mark = personInitials || (personName ? personName.trim().slice(0, 1).toUpperCase() : '')
  const body = (
    <>
      <div className="appt-card-when">
        <strong>{when.time}</strong>
        <span>{when.date}</span>
      </div>
      <div className="appt-card-body">
        <div className="appt-card-who">
          {mark ? <span className="appt-card-avatar" aria-hidden="true">{mark}</span> : null}
          <div className="appt-card-who-text">
            <strong className="appt-card-title">{title}</strong>
            {sub ? <p className="appt-card-sub muted">{sub}</p> : null}
          </div>
        </div>
        <div className="appt-card-meta">
          <span className={`badge ${statusBadgeClass(status)}`}>{statusLabel(status)}</span>
          {typeof priceMinor === 'number' ? <span className="meta">{formatMoney(priceMinor)}</span> : null}
        </div>
      </div>
    </>
  )

  return (
    <article className={`appt-card appt-card--${tone}`}>
      {to ? (
        <Link className="appt-card-main" to={to}>
          {body}
        </Link>
      ) : (
        <div className="appt-card-main">{body}</div>
      )}
      {actions ? <div className="appt-card-actions">{actions}</div> : null}
    </article>
  )
}

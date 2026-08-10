import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { statusBadgeClass, statusLabel } from '@/shared/lib/status'

type Appointment = {
  id: string
  service_name: string
  status: string
  starts_at: string
  ends_at: string
  price_minor: number
}

function dateKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDayHeading(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function CalendarPage() {
  const { accessToken } = useAuth()

  const query = useQuery({
    queryKey: ['appointments', 'master', 'calendar'],
    queryFn: () =>
      apiRequest<{ items: Appointment[] }>('/v1/appointments/mine?role=master', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const grouped = useMemo(() => {
    const items = [...(query.data?.items ?? [])].sort(
      (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
    )
    const map = new Map<string, Appointment[]>()
    for (const a of items) {
      const key = dateKey(a.starts_at)
      const list = map.get(key) ?? []
      list.push(a)
      map.set(key, list)
    }
    return [...map.entries()]
  }, [query.data])

  return (
    <main className="page stack">
      <h1>Календарь</h1>
      <p className="muted">Записи мастера по дням</p>

      {query.isLoading && <div className="state-box">Загрузка…</div>}
      {query.isError && <div className="state-box error">Не удалось загрузить записи</div>}
      {query.data && query.data.items.length === 0 && (
        <div className="state-box">Записей пока нет</div>
      )}

      {grouped.map(([day, items]) => (
        <section key={day} className="card stack">
          <h2 style={{ textTransform: 'capitalize' }}>{formatDayHeading(day)}</h2>
          <div className="list">
            {items.map((a) => (
              <Link key={a.id} to={`/appointments/${a.id}`} className="list-item">
                <div className="row between">
                  <strong>{a.service_name}</strong>
                  <span className={`badge ${statusBadgeClass(a.status)}`}>{statusLabel(a.status)}</span>
                </div>
                <p>
                  {new Date(a.starts_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  {' – '}
                  {new Date(a.ends_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  {' · '}
                  {formatMoney(a.price_minor)}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  )
}

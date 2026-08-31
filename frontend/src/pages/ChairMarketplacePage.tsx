import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiRequest } from '@/shared/api/client'
import { formatUserError } from '@/shared/lib/app-error'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { useAuth } from '@/features/auth/AuthProvider'
import { datetimeLocalToIso } from '@/shared/lib/time'
import { LEASE_LABELS, type ChairLease, type SalonChair } from '@/shared/lib/work-mode'

export function ChairMarketplacePage() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tz = 'Asia/Krasnoyarsk'

  const chairs = useQuery({
    queryKey: ['chair-marketplace'],
    queryFn: () => apiRequest<{ items: SalonChair[] }>('/v1/chairs/marketplace', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const leases = useQuery({
    queryKey: ['my-chair-leases'],
    queryFn: () => apiRequest<{ items: ChairLease[] }>('/v1/me/chair-leases', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const request = useMutation({
    mutationFn: () => apiRequest(`/v1/chairs/${selected}/leases`, {
      method: 'POST',
      token: accessToken,
      body: { starts_at: datetimeLocalToIso(start, tz), ends_at: datetimeLocalToIso(end, tz) },
    }),
    onSuccess: () => {
      setError(null)
      setSelected(null)
      void qc.invalidateQueries({ queryKey: ['my-chair-leases'] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось отправить запрос')),
  })

  return (
    <main className="page stack">
      <h1>Аренда кресел</h1>
      <p className="muted">Доступные кресла салонов. После одобрения владельцем кресло появится в вашем графике.</p>
      {error && <ErrorBanner error={error} />}
      {(chairs.data?.items ?? []).map((c) => (
        <article key={c.id} className="card stack" data-testid="marketplace-chair">
          <strong>{c.name}</strong>
          {c.description && <p>{c.description}</p>}
          {c.rent_note && <p className="muted">{c.rent_note}</p>}
          <button className="btn btn-primary" type="button" onClick={() => setSelected(c.id)}>Запросить аренду</button>
        </article>
      ))}
      {selected && (
        <section className="card stack" data-testid="lease-request-form">
          <h2>Период аренды</h2>
          <div className="field">
            <label htmlFor="lease-start">Начало</label>
            <input id="lease-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="lease-end">Конец</label>
            <input id="lease-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="button" data-testid="submit-lease" disabled={request.isPending} onClick={() => request.mutate()}>
            Отправить запрос
          </button>
        </section>
      )}
      <h2>Мои аренды</h2>
      {(leases.data?.items ?? []).map((l) => (
        <article key={l.id} className="card stack" data-testid="my-lease">
          <strong>{l.chair?.name || 'Кресло'}</strong>
          <p>{LEASE_LABELS[l.status] || l.status}</p>
          <p className="muted">{new Date(l.starts_at).toLocaleString('ru-RU')} — {new Date(l.ends_at).toLocaleString('ru-RU')}</p>
        </article>
      ))}
    </main>
  )
}

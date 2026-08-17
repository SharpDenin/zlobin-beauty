import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useState } from 'react'

type Snapshot = {
  plan: string
  status: string
  effective_plan: string
  trial_ends_at?: string
  paid_until?: string
  features?: string[]
}

export function SubscriptionPage() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const sub = useQuery({
    queryKey: ['me-subscription'],
    queryFn: () => apiRequest<Snapshot>('/v1/me/subscription', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const dev = useMutation({
    mutationFn: (body: { plan: string; status: string }) =>
      apiRequest('/v1/me/subscription/dev', { token: accessToken, body }),
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['me-subscription'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Недоступно в production'),
  })

  const s = sub.data
  const trialDays = s?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(s.trial_ends_at).getTime() - Date.now()) / 86400000))
    : null
  const isTrial = s?.status === 'trial'
  const isPremium = s?.effective_plan === 'premium'

  return (
    <main className="page stack">
      <h1>Подписка</h1>
      {sub.isLoading && <div className="state-box">Загрузка…</div>}
      {error && <div className="state-box error">{error}</div>}
      <section className="card stack">
        <p className="muted">Текущий план</p>
        <h2>{isPremium ? (isTrial ? 'Premium Trial' : 'Premium') : 'Free'}</h2>
        {isTrial && s?.trial_ends_at && (
          <p>До {new Date(s.trial_ends_at).toLocaleDateString('ru-RU')} · осталось {trialDays} дн.</p>
        )}
        {s?.paid_until && <p className="muted">Оплачено до {new Date(s.paid_until).toLocaleDateString('ru-RU')}</p>}
      </section>
      <section className="card stack">
        <h2>Free vs Premium</h2>
        <div className="compare-grid">
          <article className="card stack-sm">
            <strong>Free</strong>
            <p>Записи, календарь, клиенты</p>
            <p>Схема услуги обязательна при завершении</p>
          </article>
          <article className="card stack-sm">
            <strong>Premium</strong>
            <p>3 месяца trial для новых мастеров и поставщиков</p>
            <p>Можно не раскрывать схему услуги</p>
            <p>Расширенная аналитика</p>
          </article>
        </div>
      </section>
        {import.meta.env.DEV && (
        <section className="card stack">
          <h2>Demo / dev</h2>
          <p className="muted">Боевой эквайринг не подключён. Эти кнопки видны только в development.</p>
          <div className="row">
            <button className="btn btn-primary" type="button" onClick={() => dev.mutate({ plan: 'premium', status: 'active' })}>Активировать Premium</button>
            <button className="btn btn-secondary" type="button" onClick={() => dev.mutate({ plan: 'premium', status: 'trial' })}>Вернуть Trial</button>
            <button className="btn btn-secondary" type="button" onClick={() => dev.mutate({ plan: 'free', status: 'expired' })}>Free</button>
          </div>
        </section>
        )}
    </main>
  )
}

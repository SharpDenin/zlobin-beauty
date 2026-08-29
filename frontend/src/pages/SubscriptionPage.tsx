import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { Modal } from '@/shared/ui/Modal'
import { useState } from 'react'

type Snapshot = {
  plan: string
  status: string
  effective_plan: string
  trial_ends_at?: string
  paid_until?: string
  features?: string[]
  dev_controls?: boolean
}

const ROWS = [
  { label: 'Записи и календарь', free: true, premium: true },
  { label: 'Клиенты и услуги', free: true, premium: true },
  { label: 'Обязательное заполнение схемы услуги', free: true, premium: false },
  { label: 'Можно не раскрывать схему услуги', free: false, premium: true },
] as const

function Cell({ on }: { on: boolean }) {
  return <span className={on ? 'badge badge-confirmed' : 'badge badge-default'}>{on ? 'Есть' : 'Нет'}</span>
}

export function SubscriptionPage() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const sub = useQuery({
    queryKey: ['me-subscription'],
    queryFn: () => apiRequest<Snapshot>('/v1/me/subscription', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const dev = useMutation({
    mutationFn: (body: { plan: string; status: string }) =>
      apiRequest('/v1/me/subscription/dev', { token: accessToken, body }),
    onSuccess: () => {
      setError(null)
      void qc.invalidateQueries({ queryKey: ['me-subscription'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Недоступно в production'),
  })

  const s = sub.data
  const trialDays = s?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(s.trial_ends_at).getTime() - Date.now()) / 86400000))
    : null
  const isTrial = s?.status === 'trial'
  const isPremium = s?.effective_plan === 'premium'
  const expired = s?.status === 'expired'
  const planTitle = isPremium ? (isTrial ? 'Premium Trial' : 'Premium') : expired ? 'Trial истёк · Free' : 'Free'
  const ends = s?.trial_ends_at ? new Date(s.trial_ends_at).toLocaleDateString('ru-RU') : null
  const trialEndingSoon = isTrial && trialDays != null && trialDays <= 7

  return (
    <main className="page stack subscription-page">
      <div className="stack-sm">
        <p className="eyebrow">Профиль</p>
        <h1>Подписка</h1>
        <p className="muted">Новым мастерам и поставщикам Premium Trial открывается сразу на 3 месяца.</p>
      </div>
      {sub.isLoading && <div className="state-box">Загрузка…</div>}
      {error && <div className="state-box error">{error}</div>}

      {isTrial && ends && (
        <section className="card stack-sm trial-banner" data-testid="subscription-trial-banner">
          <p className="eyebrow">Trial</p>
          <h2>Premium активирован бесплатно на 3 месяца</h2>
          <p>Пробный Premium до {ends} · осталось {trialDays} дн.</p>
          {trialEndingSoon && <p className="muted">Premium Trial закончится через {trialDays} дн.</p>}
        </section>
      )}

      {expired && !isPremium && (
        <section className="card stack-sm" data-testid="subscription-expired-banner">
          <p className="eyebrow">Trial завершён</p>
          <h2>Пробный Premium завершён</h2>
          <p>Сейчас используется Free. Схема услуги обязательна при завершении приёма.</p>
        </section>
      )}

      <section className="card stack">
        <p className="muted">Текущий план</p>
        <h2>{planTitle}</h2>
        <p>
          Статус: {s?.status === 'trial' ? 'Пробный период' : s?.status === 'active' ? 'Активна' : s?.status === 'expired' ? 'Истекла' : s?.status ?? '—'}
        </p>
        {isTrial && ends && <p>Окончание trial: {ends}</p>}
        {s?.paid_until && <p className="muted">Оплачено до {new Date(s.paid_until).toLocaleDateString('ru-RU')}</p>}
        {!isPremium && (
          <p className="muted">На Free схема услуги обязательна при завершении приёма.</p>
        )}
        {!isPremium && (
          <button className="btn btn-primary" type="button" onClick={() => setUpgradeOpen(true)}>
            Перейти на Premium
          </button>
        )}
        <Link className="btn btn-secondary" to="/profile">К профилю</Link>
      </section>

      <Modal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        title="Premium"
        footer={
          <button className="btn btn-primary" type="button" onClick={() => setUpgradeOpen(false)}>Понятно</button>
        }
      >
        <p>Онлайн-оплата будет подключена позже. Сейчас можно пользоваться trial или demo-переключателем в dev-окружении.</p>
      </Modal>

      <section className="card stack">
        <h2>Free и Premium</h2>
        <p className="muted">Только функции, которые уже есть в продукте.</p>
        <div className="compare-table">
          <div className="compare-row compare-head">
            <span>Возможность</span>
            <strong>Free</strong>
            <strong>Premium</strong>
          </div>
          {ROWS.map((row) => (
            <div key={row.label} className="compare-row">
              <span>{row.label}</span>
              <Cell on={row.free} />
              <Cell on={row.premium} />
            </div>
          ))}
        </div>
      </section>

      {s?.dev_controls && (
        <section className="card stack">
          <h2>Demo / dev</h2>
          <p className="muted">Видно только в demo-окружении. Боевой эквайринг не подключён.</p>
          <div className="chip-row">
            <button className="btn btn-secondary" type="button" onClick={() => dev.mutate({ plan: 'free', status: 'expired' })}>FREE</button>
            <button className="btn btn-secondary" type="button" onClick={() => dev.mutate({ plan: 'premium', status: 'trial' })}>TRIAL</button>
            <button className="btn btn-primary" type="button" onClick={() => dev.mutate({ plan: 'premium', status: 'active' })}>PREMIUM</button>
            <button className="btn btn-secondary" type="button" onClick={() => dev.mutate({ plan: 'premium', status: 'expired' })}>EXPIRED TRIAL</button>
          </div>
        </section>
      )}
    </main>
  )
}

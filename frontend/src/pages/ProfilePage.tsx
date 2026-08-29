import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { initials } from '@/shared/lib/initials'
import { PageHeader } from '@/app/layout'

const profileSchema = z.object({
  display_name: z.string().min(2, 'Минимум 2 символа'),
  city: z.string().optional(),
})

const ROLE_LABEL: Record<string, string> = {
  client: 'Клиент',
  master: 'Мастер',
  supplier: 'Поставщик',
  salon_admin: 'Администратор',
  system_admin: 'Системный админ',
}

function roleLabel(role: string) {
  return ROLE_LABEL[role] ?? role
}

export function ProfilePage() {
  const { user, accessToken, updateUser, logout } = useAuth()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    values: {
      display_name: user?.display_name ?? '',
      city: user?.city ?? '',
    },
  })

  const save = useMutation({
    mutationFn: (v: z.infer<typeof profileSchema>) =>
      apiRequest<{
        id: string
        display_name: string
        city: string
        email: string | null
        phone: string | null
        roles: string[]
        status: string
      }>('/v1/auth/me', {
        method: 'PATCH',
        token: accessToken,
        body: { display_name: v.display_name, city: (v.city ?? '').trim() },
      }),
    onSuccess: (me) => {
      updateUser(me)
      setOk('Профиль сохранён')
      setError(null)
      void qc.invalidateQueries({ queryKey: ['home-masters'] })
    },
    onError: (e) => {
      setOk(null)
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить')
    },
  })

  const cabinet = useCabinet()
  const showSubscription = cabinet.kind !== 'salon_admin' && cabinet.kind !== 'client'

  return (
    <main className="page stack">
      <PageHeader title="Профиль" />

      <section className="card profile-hero">
        <div className="avatar-circle" aria-hidden="true">{initials(user?.display_name)}</div>
        <div className="stack-sm">
          <h2>{user?.display_name}</h2>
          <p className="muted">{user?.email ?? 'Email не указан'}</p>
          <div className="appt-card-meta">
            {(user?.roles ?? []).map((r) => (
              <span key={r} className="badge badge-default">{roleLabel(r)}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2>Личные данные</h2>
        {error && <div className="state-box error">{error}</div>}
        {ok && <div className="state-box success">{ok}</div>}
        <form className="stack" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <div className="field">
            <label htmlFor="display_name">Имя</label>
            <input id="display_name" {...form.register('display_name')} />
            {form.formState.errors.display_name && (
              <span className="error">{form.formState.errors.display_name.message}</span>
            )}
          </div>
          <div className="field">
            <label htmlFor="city">Город</label>
            <input id="city" {...form.register('city')} placeholder="Москва" />
            <span className="hint">Нужен для поиска мастеров рядом</span>
          </div>
          <button className={`btn btn-primary${save.isPending ? ' btn-loading' : ''}`} type="submit" disabled={save.isPending}>
            {save.isPending ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </form>
      </section>

      <SubscriptionHints />

      <section className="card stack">
        <h2>Действия</h2>
        <div className="profile-actions">
          <Link className="btn btn-secondary" to="/appointments">Мои записи</Link>
          {showSubscription && <Link className="btn btn-secondary" to="/profile/subscription">Подписка</Link>}
          <Link className="btn btn-secondary" to="/messages">Сообщения</Link>
          <Link className="btn btn-secondary" to="/notifications">Уведомления</Link>
          <button className="btn btn-danger" type="button" onClick={() => void logout()}>Выйти</button>
        </div>
      </section>
    </main>
  )
}

function SubscriptionHints() {
  const { accessToken } = useAuth()
  const sub = useQuery({
    queryKey: ['me-subscription'],
    queryFn: () =>
      apiRequest<{ effective_plan: string; status: string; trial_ends_at?: string }>(
        '/v1/me/subscription',
        { token: accessToken },
      ),
    enabled: Boolean(accessToken),
  })
  const hints = useQuery({
    queryKey: ['me-hints'],
    queryFn: () => apiRequest<{ hints_enabled: boolean }>('/v1/me/hints', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const qc = useQueryClient()
  const toggleHints = useMutation({
    mutationFn: () =>
      apiRequest('/v1/me/hints', {
        method: 'PATCH',
        token: accessToken,
        body: { hints_enabled: !(hints.data?.hints_enabled ?? true) },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me-hints'] }),
  })
  const plan = sub.data?.effective_plan === 'premium' ? 'Premium' : 'Free'
  const trialUntil = sub.data?.status === 'trial' && sub.data.trial_ends_at
    ? new Date(sub.data.trial_ends_at).toLocaleDateString('ru-RU')
    : null
  return (
    <section className="card stack-sm">
      <h2>Подписка</h2>
      <p>
        <strong>{plan}</strong>
        {trialUntil ? ` · пробный период до ${trialUntil}` : ''}
      </p>
      <label className="field-check">
        <input
          type="checkbox"
          data-testid="hints-toggle"
          checked={hints.data?.hints_enabled !== false}
          onChange={() => toggleHints.mutate()}
        />
        <span>Подсказки интерфейса</span>
      </label>
    </section>
  )
}

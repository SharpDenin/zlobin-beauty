import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest, ApiError } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'

const profileSchema = z.object({
  display_name: z.string().min(2, 'Минимум 2 символа'),
  city: z.string().optional(),
})

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

  return (
    <main className="page stack">
      <h1>Профиль</h1>
      <section className="card stack">
        <p className="muted">{user?.email ?? 'Email не указан'}</p>
        <p className="muted">Роли: {user?.roles.join(', ') || '—'}</p>
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
            <p className="muted">Используется на главной и в поиске мастеров.</p>
          </div>
          <button className="btn btn-primary" type="submit" disabled={save.isPending}>
            Сохранить
          </button>
        </form>
        <SubscriptionHints />
        <div className="row">
          <Link className="btn btn-secondary" to="/appointments">Мои записи</Link>
          <Link className="btn btn-secondary" to="/profile/subscription">Подписка</Link>
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
  const toggleHints = useMutation({
    mutationFn: () =>
      apiRequest('/v1/me/hints', {
        method: 'PATCH',
        token: accessToken,
        body: { hints_enabled: !(hints.data?.hints_enabled ?? true) },
      }),
  })
  const plan = sub.data?.effective_plan === 'premium' ? 'Premium' : 'Free'
  const trial = sub.data?.status === 'trial' && sub.data.trial_ends_at
    ? `Пробный период до ${new Date(sub.data.trial_ends_at).toLocaleDateString('ru-RU')}`
    : null
  return (
    <section className="stack-sm">
      <h2>Подписка</h2>
      <p>{plan}{trial ? ` · ${trial}` : ''}</p>
      <p className="muted">Новым пользователям — 3 месяца Premium. После trial без оплаты включается Free.</p>
      <label className="field-check">
        <input
          type="checkbox"
          checked={hints.data?.hints_enabled !== false}
          onChange={() => toggleHints.mutate()}
        />
        <span>Показывать подсказки новичкам</span>
      </label>
    </section>
  )
}

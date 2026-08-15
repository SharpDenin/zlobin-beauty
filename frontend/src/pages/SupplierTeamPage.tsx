import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useSupplierOrg } from '@/shared/lib/commerce'

type Rep = { id: string; city?: string; territory?: string; active?: boolean; user_id?: string }

export function SupplierTeamPage() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const { supplierOrgId, orgs } = useSupplierOrg()
  const [email, setEmail] = useState('')
  const [city, setCity] = useState('Красноярск')
  const [error, setError] = useState<string | null>(null)

  const reps = useQuery({
    queryKey: ['supplier-reps', supplierOrgId],
    queryFn: () => apiRequest<{ items: Rep[] }>(`/v1/organizations/${supplierOrgId}/representatives`, { token: accessToken }),
    enabled: Boolean(accessToken && supplierOrgId),
  })

  const create = useMutation({
    mutationFn: async () => {
      const login = await apiRequest<{ user: { id: string } }>('/v1/auth/lookup', { token: accessToken, body: { email } }).catch(() => null)
      const userId = login?.user?.id
      if (!userId) {
        throw new ApiError('Сначала зарегистрируйте представителя', 'validation_error', 400)
      }
      return apiRequest(`/v1/organizations/${supplierOrgId}/representatives`, {
        token: accessToken,
        body: { user_id: userId, city, territory: city },
      })
    },
    onSuccess: async () => {
      setError(null)
      setEmail('')
      await qc.invalidateQueries({ queryKey: ['supplier-reps'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось назначить'),
  })

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>

  return (
    <main className="page stack">
      <h1>Представители</h1>
      <p className="muted">Видите только свою команду. Город ограничивает маршруты по умолчанию.</p>
      {error && <div className="state-box error">{error}</div>}
      <section className="card stack">
        <h2>Назначить</h2>
        <div className="field"><label>Email аккаунта</label><input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label>Город</label><input value={city} onChange={(e) => setCity(e.target.value)} /></div>
        <button className="btn btn-primary" type="button" disabled={create.isPending} onClick={() => create.mutate()}>Назначить</button>
      </section>
      <div className="list">
        {(reps.data?.items ?? []).map((r) => (
          <article key={r.id} className="list-item">
            <strong>{r.city || 'Город не указан'}</strong>
            <p className="muted">{r.territory || 'Территория не задана'} · {r.active === false ? 'Неактивен' : 'Активен'}</p>
          </article>
        ))}
      </div>
      {reps.data && reps.data.items.length === 0 && <div className="empty-state"><h2>Пока никого нет</h2></div>}
    </main>
  )
}

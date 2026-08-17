import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useBuyerOrg } from '@/shared/lib/commerce'
import { statusBadgeClass } from '@/shared/lib/status'

type Member = { id: string; user_id?: string; role: string; status: string }

export function StaffPage() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const { buyerOrgId, buyerOrg, orgs } = useBuyerOrg()
  const [seeContacts, setSeeContacts] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('master')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const staff = useQuery({
    queryKey: ['staff', buyerOrgId],
    queryFn: () => apiRequest<{ items: Member[] }>(`/v1/organizations/${buyerOrgId}/staff`, { token: accessToken }),
    enabled: Boolean(accessToken && buyerOrgId),
  })

  useEffect(() => {
    const v = buyerOrg?.organization.masters_see_client_contacts
    if (typeof v === 'boolean') setSeeContacts(v)
  }, [buyerOrg?.organization.masters_see_client_contacts])

  const policy = useMutation({
    mutationFn: () =>
      apiRequest(`/v1/organizations/${buyerOrgId}/contact-policy`, {
        method: 'PATCH',
        token: accessToken,
        body: { masters_see_client_contacts: seeContacts },
      }),
    onSuccess: () => { setOk('Политика контактов обновлена'); setError(null) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось сохранить'),
  })

  const invite = useMutation({
    mutationFn: async () => {
      const lookup = await apiRequest<{ user: { id: string } }>('/v1/auth/lookup', {
        token: accessToken,
        body: { email: inviteEmail.trim() },
      })
      return apiRequest(`/v1/organizations/${buyerOrgId}/staff`, {
        token: accessToken,
        body: { user_id: lookup.user.id, role: inviteRole },
      })
    },
    onSuccess: async () => {
      setOk('Сотрудник добавлен')
      setError(null)
      setInviteEmail('')
      await qc.invalidateQueries({ queryKey: ['staff'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось пригласить'),
  })

  const disable = useMutation({
    mutationFn: (userId: string) =>
      apiRequest(`/v1/organizations/${buyerOrgId}/staff/disable`, {
        token: accessToken,
        body: { user_id: userId },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['staff'] })
    },
  })

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (!buyerOrgId) return <main className="page"><div className="empty-state"><h2>Нужен салон</h2></div></main>

  return (
    <main className="page stack">
      <h1>Команда салона</h1>
      <p className="muted">{buyerOrg?.organization.name}</p>
      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}
      <section className="card stack">
        <h2>Показывать контактные данные клиентов мастерам</h2>
        <label className="field-check">
          <input type="checkbox" checked={seeContacts} onChange={(e) => setSeeContacts(e.target.checked)} />
          <span>Мастера видят телефон и email клиента</span>
        </label>
        <button className="btn btn-primary" type="button" disabled={policy.isPending} onClick={() => policy.mutate()}>
          Сохранить политику
        </button>
      </section>
      <section className="card stack">
        <h2>Добавить сотрудника</h2>
        <p className="muted">Приглашение по email уже зарегистрированного пользователя.</p>
        <div className="field">
          <label htmlFor="invite-email">Email</label>
          <input id="invite-email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="admin1@demo.local" />
        </div>
        <div className="field">
          <label htmlFor="invite-role">Роль</label>
          <select id="invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="master">Мастер</option>
            <option value="admin">Администратор</option>
          </select>
        </div>
        <button className="btn btn-primary" type="button" disabled={invite.isPending || inviteEmail.trim().length < 5} onClick={() => invite.mutate()}>
          Пригласить
        </button>
      </section>
      <div className="list">
        {(staff.data?.items ?? []).map((m) => (
          <article key={m.id} className="list-item row between">
            <div>
              <strong>{m.role === 'owner' ? 'Владелец' : m.role === 'admin' ? 'Администратор' : m.role === 'master' ? 'Мастер' : 'Сотрудник'}</strong>
              <p className="muted"><span className={`badge ${statusBadgeClass(m.status)}`}>{m.status === 'active' ? 'Активен' : 'Отключён'}</span></p>
            </div>
            {m.status === 'active' && m.role !== 'owner' && m.user_id && (
              <button className="btn btn-secondary btn-compact" type="button" onClick={() => disable.mutate(m.user_id!)}>Отключить</button>
            )}
          </article>
        ))}
      </div>
    </main>
  )
}

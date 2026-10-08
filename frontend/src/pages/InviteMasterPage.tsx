import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { formatUserError } from '@/shared/lib/app-error'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { PageLoading } from '@/shared/ui/PageLoading'

type InviteRow = {
  id: string
  role: string
  expires_at: string
  max_uses: number
  use_count: number
  revoked_at?: string | null
  url?: string
}

export function InviteMasterPage() {
  const { accessToken } = useAuth()
  const cabinet = useCabinet()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [orgId, setOrgId] = useState('')
  const [activeUrl, setActiveUrl] = useState<string | null>(null)

  const salonOrgs = useMemo(
    () => cabinet.orgs.filter((o) => o.organization.type !== 'supplier'),
    [cabinet.orgs],
  )
  const selectedOrgId = orgId || cabinet.selectedOrg?.organization.id || salonOrgs[0]?.organization.id

  const invites = useQuery({
    queryKey: ['salon-invites', selectedOrgId],
    queryFn: () => apiRequest<{ items: InviteRow[] }>(`/v1/organizations/${selectedOrgId}/invites`, { token: accessToken }),
    enabled: Boolean(accessToken && selectedOrgId),
  })

  const createQr = useMutation({
    mutationFn: () =>
      apiRequest<{ url: string; token: string; id?: string }>(`/v1/organizations/${selectedOrgId}/invites`, {
        token: accessToken,
        body: { role: 'master', hours: 72, max_uses: 1 },
      }),
    onSuccess: async (res) => {
      setActiveUrl(res.url)
      setOk('QR создан. Одноразовый, действует 72 часа.')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['salon-invites', selectedOrgId] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось создать приглашение')),
  })

  const revoke = useMutation({
    mutationFn: (inviteId: string) =>
      apiRequest(`/v1/organizations/${selectedOrgId}/invites/${inviteId}/revoke`, {
        method: 'POST',
        token: accessToken,
      }),
    onSuccess: async () => {
      setOk('Приглашение отозвано')
      setActiveUrl(null)
      await qc.invalidateQueries({ queryKey: ['salon-invites', selectedOrgId] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось отозвать приглашение')),
  })

  if (!cabinet.ready) return <PageLoading />
  if (!selectedOrgId) {
    return (
      <main className="page stack">
        <h1>Пригласить мастера</h1>
        <div className="empty-state">
          <h2>Нужен салон</h2>
          <p className="muted">Создайте салон, чтобы выпускать QR-приглашения.</p>
          <Link className="btn btn-primary" to="/master">К профилю</Link>
        </div>
      </main>
    )
  }

  const active = (invites.data?.items ?? []).filter((i) => !i.revoked_at && new Date(i.expires_at) > new Date() && i.use_count < i.max_uses)

  return (
    <main className="page stack invite-qr-page" data-testid="invite-master-page">
      <div className="stack-sm">
        <p className="eyebrow">Команда</p>
        <h1>Пригласить мастера</h1>
        <p className="muted">Покажите QR мастеру. После регистрации он автоматически привяжется к вашему салону — без создания своего.</p>
      </div>

      {salonOrgs.length > 1 && (
        <div className="field">
          <label htmlFor="invite-master-org">Салон</label>
          <select id="invite-master-org" value={selectedOrgId} onChange={(e) => { setOrgId(e.target.value); setActiveUrl(null) }}>
            {salonOrgs.map((o) => (
              <option key={o.organization.id} value={o.organization.id}>{o.organization.name}</option>
            ))}
          </select>
        </div>
      )}

      {error && <ErrorBanner error={error} />}
      {ok && <div className="state-box success" role="status">{ok}</div>}

      <section className="card stack invite-qr-block">
        <h2>QR-код</h2>
        {activeUrl ? (
          <>
            <img
              alt="QR для регистрации мастера"
              width={280}
              height={280}
              src={`https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=12&data=${encodeURIComponent(activeUrl)}`}
            />
            <p className="muted break-all">{activeUrl}</p>
            <div className="row wrap gap">
              <button className="btn btn-secondary" type="button" onClick={() => void navigator.clipboard.writeText(activeUrl)}>Скопировать ссылку</button>
              <button className="btn btn-primary" type="button" disabled={createQr.isPending} onClick={() => createQr.mutate()}>
                Новый QR
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">Создайте одноразовый код и покажите его мастеру на телефоне.</p>
            <button className="btn btn-primary btn-block" type="button" disabled={createQr.isPending} onClick={() => createQr.mutate()}>
              {createQr.isPending ? 'Создаём…' : 'Создать QR'}
            </button>
          </>
        )}
      </section>

      <section className="card stack">
        <h2>Активные приглашения</h2>
        {invites.isLoading && <div className="state-box">Загрузка…</div>}
        {active.length === 0 && !invites.isLoading && <p className="muted">Нет активных QR.</p>}
        <div className="list">
          {active.map((inv) => (
            <article key={inv.id} className="list-item row between">
              <div>
                <strong>Мастер</strong>
                <p className="muted">до {new Date(inv.expires_at).toLocaleString('ru-RU')} · использовано {inv.use_count}/{inv.max_uses}</p>
              </div>
              <button className="btn btn-secondary btn-compact" type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(inv.id)}>
                Отозвать
              </button>
            </article>
          ))}
        </div>
        <Link className="btn btn-ghost" to="/staff">К команде салона</Link>
      </section>
    </main>
  )
}

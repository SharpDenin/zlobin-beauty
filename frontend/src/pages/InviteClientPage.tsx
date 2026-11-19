import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { formatUserError } from '@/shared/lib/app-error'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { PageLoading } from '@/shared/ui/PageLoading'

type InviteRow = {
  id: string
  expires_at: string
  max_uses: number
  use_count: number
  revoked_at?: string | null
  organization_id?: string
}

async function shareOrCopy(url: string) {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: 'Приглашение в Salon-X',
        text: 'Перейдите по ссылке, чтобы связаться со мной в Salon-X',
        url,
      })
      return
    } catch {
      // fall through to clipboard
    }
  }
  await navigator.clipboard.writeText(url)
}

export function InviteClientPage() {
  const { accessToken } = useAuth()
  const cabinet = useCabinet()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [activeUrl, setActiveUrl] = useState<string | null>(null)

  const orgId = cabinet.selectedOrg?.organization.id || cabinet.master?.organization_id || undefined

  const invites = useQuery({
    queryKey: ['client-invites'],
    queryFn: () => apiRequest<{ items: InviteRow[] }>('/v1/clients/invites', { token: accessToken }),
    enabled: Boolean(accessToken),
  })

  const createQr = useMutation({
    mutationFn: () =>
      apiRequest<{ url: string; token: string; id?: string }>('/v1/clients/invites', {
        token: accessToken,
        body: {
          organization_id: orgId || undefined,
          hours: 168,
          max_uses: 20,
        },
      }),
    onSuccess: async (res) => {
      setActiveUrl(res.url)
      setOk('QR создан. Действует 7 дней, до 20 переходов.')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['client-invites'] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось создать приглашение')),
  })

  const revoke = useMutation({
    mutationFn: (inviteId: string) =>
      apiRequest(`/v1/clients/invites/${inviteId}/revoke`, {
        method: 'POST',
        token: accessToken,
      }),
    onSuccess: async () => {
      setOk('Приглашение отозвано')
      setActiveUrl(null)
      await qc.invalidateQueries({ queryKey: ['client-invites'] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось отозвать приглашение')),
  })

  if (!cabinet.ready) return <PageLoading />

  const active = (invites.data?.items ?? []).filter(
    (i) => !i.revoked_at && new Date(i.expires_at) > new Date() && i.use_count < i.max_uses,
  )

  return (
    <main className="page stack invite-qr-page" data-testid="invite-client-page">
      <div className="stack-sm">
        <p className="eyebrow">Клиенты</p>
        <h1>Пригласить клиента</h1>
        <p className="muted">
          Покажите QR или отправьте ссылку. Клиент войдёт или зарегистрируется и подтвердит связь с вами —
          без автоматической привязки чужих данных.
        </p>
      </div>

      {error && <ErrorBanner error={error} />}
      {ok && <div className="state-box success" role="status">{ok}</div>}

      <section className="card stack invite-qr-block">
        <h2>QR-код</h2>
        {activeUrl ? (
          <>
            <img
              alt="QR для приглашения клиента"
              width={280}
              height={280}
              src={`https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=12&data=${encodeURIComponent(activeUrl)}`}
            />
            <p className="muted break-all" data-testid="invite-client-url">{activeUrl}</p>
            <div className="row wrap gap">
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => void navigator.clipboard.writeText(activeUrl).then(() => setOk('Ссылка скопирована'))}
              >
                Скопировать ссылку
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => void shareOrCopy(activeUrl).then(() => setOk('Готово'))}
              >
                Поделиться
              </button>
              <button className="btn btn-primary" type="button" disabled={createQr.isPending} onClick={() => createQr.mutate()}>
                Новый QR
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">Создайте код и покажите его клиенту с другого телефона.</p>
            <button
              className="btn btn-primary btn-block"
              type="button"
              data-testid="invite-client-create"
              disabled={createQr.isPending}
              onClick={() => createQr.mutate()}
            >
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
                <strong>Клиент</strong>
                <p className="muted">
                  до {new Date(inv.expires_at).toLocaleString('ru-RU')} · использовано {inv.use_count}/{inv.max_uses}
                </p>
              </div>
              <button
                className="btn btn-secondary btn-compact"
                type="button"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(inv.id)}
              >
                Отозвать
              </button>
            </article>
          ))}
        </div>
        <Link className="btn btn-ghost" to="/clients">К списку клиентов</Link>
      </section>
    </main>
  )
}

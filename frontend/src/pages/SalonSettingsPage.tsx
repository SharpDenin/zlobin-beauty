import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { apiRequest } from '@/shared/api/client'
import { formatUserError } from '@/shared/lib/app-error'
import { useAuth } from '@/features/auth/AuthProvider'
import { useBuyerOrg } from '@/shared/lib/commerce'
import { Hint } from '@/shared/ui/Hint'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { LEASE_LABELS, type ChairLease, type SalonChair } from '@/shared/lib/work-mode'

export function SalonSettingsPage() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const { buyerOrgId, buyerOrg, orgs } = useBuyerOrg()
  const [seeContacts, setSeeContacts] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

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
    onSuccess: async () => {
      setOk('Политика контактов обновлена')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['orgs-mine'] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось сохранить')),
  })

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (!buyerOrgId) return <main className="page"><div className="empty-state"><h2>Нужен салон</h2></div></main>

  return (
    <main className="page stack">
      <h1>Настройки салона</h1>
      <p className="muted">{buyerOrg?.organization.name}</p>
      {error && <ErrorBanner error={error} />}
      {ok && <div className="state-box success">{ok}</div>}
      <section className="card stack">
        <h2>
          Показывать контактные данные клиентов мастерам{' '}
          <Hint id="owner-privacy" title="Контакты клиентов">Если выключено, мастера салона не увидят телефон и email клиентов, записавшихся через Salon-X.</Hint>
        </h2>
        <p className="muted">Если выключено, мастера салона не увидят телефон и email клиентов, записавшихся через Salon-X.</p>
        <label className="field-check">
          <input
            type="checkbox"
            data-testid="contact-privacy-toggle"
            checked={seeContacts}
            onChange={(e) => setSeeContacts(e.target.checked)}
          />
          <span>Мастера видят телефон и email клиента</span>
        </label>
        <button className="btn btn-primary" type="button" disabled={policy.isPending} onClick={() => policy.mutate()}>
          Сохранить политику
        </button>
      </section>
      <ChairManagement orgId={buyerOrgId} branchId={buyerOrg?.branches[0]?.id} token={accessToken} />
    </main>
  )
}

function ChairManagement({ orgId, branchId, token }: { orgId?: string; branchId?: string; token?: string | null }) {
  const qc = useQueryClient()
  const [name, setName] = useState('Кресло 1')
  const [note, setNote] = useState('')
  const [listed, setListed] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const chairs = useQuery({
    queryKey: ['org-chairs', orgId],
    queryFn: () => apiRequest<{ items: SalonChair[] }>(`/v1/chairs?organization_id=${orgId}`, { token }),
    enabled: Boolean(token && orgId),
  })
  const leases = useQuery({
    queryKey: ['org-leases', orgId],
    queryFn: () => apiRequest<{ items: ChairLease[] }>(`/v1/chair-leases?organization_id=${orgId}`, { token }),
    enabled: Boolean(token && orgId),
  })
  const create = useMutation({
    mutationFn: () => apiRequest('/v1/chairs', {
      method: 'POST',
      token,
      body: { organization_id: orgId, branch_id: branchId, name, description: '', listed_for_rent: listed, rent_note: note },
    }),
    onSuccess: () => {
      setError(null)
      void qc.invalidateQueries({ queryKey: ['org-chairs'] })
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось создать кресло')),
  })
  const approve = useMutation({
    mutationFn: (id: string) => apiRequest(`/v1/chair-leases/${id}/approve`, { method: 'POST', token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-leases'] }),
  })
  const reject = useMutation({
    mutationFn: (id: string) => apiRequest(`/v1/chair-leases/${id}/reject`, { method: 'POST', token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-leases'] }),
  })

  if (!orgId || !branchId) return null

  return (
    <>
      <section className="card stack" data-testid="chair-admin">
        <h2>Кресла салона</h2>
        {error && <ErrorBanner error={error} />}
        <div className="field">
          <label htmlFor="chair-name">Название</label>
          <input id="chair-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="chair-note">Условия аренды</label>
          <input id="chair-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <label className="field-check">
          <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} />
          <span>Открыть для аренды</span>
        </label>
        <button className="btn btn-primary" type="button" data-testid="create-chair" disabled={create.isPending} onClick={() => create.mutate()}>
          Создать кресло
        </button>
        {(chairs.data?.items ?? []).map((c) => (
          <article key={c.id} className="card stack" data-testid="org-chair">
            <strong>{c.name}</strong>
            <p className="muted">{c.listed_for_rent ? 'Доступно для аренды' : 'Не публикуется'}</p>
          </article>
        ))}
      </section>
      <section className="card stack">
        <h2>Запросы аренды</h2>
        {(leases.data?.items ?? []).map((l) => (
          <article key={l.id} className="card stack" data-testid="lease-request">
            <strong>{l.chair?.name || 'Кресло'}</strong>
            <p>{LEASE_LABELS[l.status] || l.status}</p>
            {l.status === 'requested' && (
              <div className="row">
                <button className="btn btn-primary" type="button" data-testid="approve-lease" onClick={() => approve.mutate(l.id)}>Подтвердить</button>
                <button className="btn" type="button" onClick={() => reject.mutate(l.id)}>Отклонить</button>
              </div>
            )}
          </article>
        ))}
      </section>
    </>
  )
}

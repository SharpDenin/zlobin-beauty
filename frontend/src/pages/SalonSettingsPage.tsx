import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useBuyerOrg } from '@/shared/lib/commerce'
import { Hint } from '@/shared/ui/Hint'

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
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось сохранить'),
  })

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (!buyerOrgId) return <main className="page"><div className="empty-state"><h2>Нужен салон</h2></div></main>

  return (
    <main className="page stack">
      <h1>Настройки салона</h1>
      <p className="muted">{buyerOrg?.organization.name}</p>
      {error && <div className="state-box error">{error}</div>}
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
    </main>
  )
}

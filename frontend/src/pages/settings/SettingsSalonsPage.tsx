import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { apiRequest } from '@/shared/api/client'
import { formatUserError } from '@/shared/lib/app-error'
import { useCabinet } from '@/shared/lib/cabinet'
import { useMyOrgs, type OrgItem } from '@/shared/lib/commerce'
import { CreateSalonForm, type CreateSalonPayload } from '@/shared/ui/CreateSalonForm'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { toast } from '@/shared/ui/Toast'

function ownedSalons(items: OrgItem[]): OrgItem[] {
  return items.filter(
    (o) => o.organization.type !== 'supplier' && o.roles.map((r) => r.toLowerCase()).includes('owner'),
  )
}

export function SettingsSalonsPage() {
  const { accessToken, user } = useAuth()
  const cabinet = useCabinet()
  const qc = useQueryClient()
  const orgs = useMyOrgs()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const owned = useMemo(() => ownedSalons(orgs.data?.items ?? []), [orgs.data?.items])

  const create = useMutation({
    mutationFn: async (payload: CreateSalonPayload) => {
      const { phone, ...body } = payload
      const res = await apiRequest<{ organization: { id: string }; branch: { id: string } | null }>(
        '/v1/organizations',
        { token: accessToken, body },
      )
      if (phone && res.branch?.id) {
        await apiRequest(`/v1/branches/${res.branch.id}`, {
          method: 'PATCH',
          token: accessToken,
          body: { phone },
        })
      }
      return res
    },
    onSuccess: async (res) => {
      setError(null)
      setOk('Салон создан')
      toast.success('Салон создан')
      setShowCreate(false)
      cabinet.setSelectedOrgId(res.organization.id)
      await qc.invalidateQueries({ queryKey: ['orgs-mine'] })
    },
    onError: (e) => {
      setOk(null)
      setError(formatUserError(e, 'Не удалось создать салон'))
    },
  })

  return (
    <section className="stack" data-testid="settings-salons">
      <div className="stack-sm">
        <h2>Мои салоны</h2>
        <p className="muted">
          Организации, которыми вы владеете. Филиал необязателен — его можно добавить позже.
        </p>
      </div>

      {orgs.isLoading && <div className="state-box">Загрузка…</div>}
      {orgs.isError && <ErrorBanner error={orgs.error} fallbackTitle="Не удалось загрузить салоны" />}
      {error && <ErrorBanner error={error} />}
      {ok && <div className="state-box success" role="status">{ok}</div>}

      {!orgs.isLoading && owned.length === 0 && (
        <div className="state-box">Пока нет салонов. Создайте первый — это не требует профиля мастера.</div>
      )}

      <div className="list">
        {owned.map((item) => {
          const selected = cabinet.selectedOrg?.organization.id === item.organization.id
          const city = item.organization.city || item.branches[0]?.city || 'Город не указан'
          const branchCount = item.branches.length
          return (
            <article key={item.organization.id} className="list-item stack-sm" data-testid="settings-salon-card">
              <div className="row between gap wrap">
                <div className="stack-sm" style={{ minWidth: 0 }}>
                  <strong>{item.organization.name}</strong>
                  <p className="muted">
                    {city}
                    {item.organization.address_line ? ` · ${item.organization.address_line}` : ''}
                  </p>
                  <p className="muted">
                    {branchCount === 0 ? 'Без филиалов' : `Филиалов: ${branchCount}`}
                    {selected ? ' · выбран' : ''}
                  </p>
                </div>
                <div className="row gap wrap">
                  {!selected && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => cabinet.setSelectedOrgId(item.organization.id)}
                    >
                      Выбрать
                    </button>
                  )}
                  {selected && <span className="badge badge-success">Активный</span>}
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {!showCreate ? (
        <button type="button" className="btn btn-primary" data-testid="settings-create-salon" onClick={() => setShowCreate(true)}>
          Создать салон
        </button>
      ) : (
        <div className="card stack">
          <h3>Новый салон</h3>
          <CreateSalonForm
            pending={create.isPending}
            defaultCity={user?.city || 'Красноярск'}
            onSubmit={async (payload) => { await create.mutateAsync(payload) }}
          />
          <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>
            Отмена
          </button>
        </div>
      )}

      <p className="muted">
        Управление командой и настройками салона — в разделе{' '}
        <Link to="/salon/settings">Настройки салона</Link>.
      </p>
    </section>
  )
}

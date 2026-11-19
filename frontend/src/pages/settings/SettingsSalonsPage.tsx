import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

type Readiness = {
  ready: boolean
  missing: string[]
  checks: Array<{ key: string; label: string; ok: boolean; missing?: string }>
}

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
  const [manageId, setManageId] = useState<string | null>(null)

  const owned = useMemo(() => ownedSalons(orgs.data?.items ?? []), [orgs.data?.items])
  const managed = owned.find((o) => o.organization.id === manageId) ?? null

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
      setOk('Салон создан. Управление доступно по membership владельца — без отдельной identity-роли.')
      toast.success('Салон создан')
      setShowCreate(false)
      setManageId(res.organization.id)
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
          Создание, филиалы и публикация зависят от membership владельца — не от публикации личного профиля мастера.
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
                    {' · '}
                    {item.organization.published ? 'салон опубликован' : 'салон скрыт'}
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
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-testid="settings-manage-salon"
                    onClick={() => setManageId(item.organization.id)}
                  >
                    Управление
                  </button>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {managed && (
        <SalonManagePanel
          item={managed}
          token={accessToken}
          onClose={() => setManageId(null)}
          onChanged={async () => {
            await qc.invalidateQueries({ queryKey: ['orgs-mine'] })
          }}
        />
      )}

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
        Кресла и политика контактов — в{' '}
        <Link to="/salon/settings">Настройки салона</Link>.
      </p>
    </section>
  )
}

function SalonManagePanel({
  item,
  token,
  onClose,
  onChanged,
}: {
  item: OrgItem
  token: string | null | undefined
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const orgId = item.organization.id
  const [error, setError] = useState<string | null>(null)
  const [branchName, setBranchName] = useState('Основной')
  const [branchCity, setBranchCity] = useState(item.organization.city || 'Красноярск')
  const [branchAddress, setBranchAddress] = useState(item.organization.address_line || '')
  const [branchPhone, setBranchPhone] = useState('')

  const orgReady = useQuery({
    queryKey: ['org-readiness', orgId],
    queryFn: () => apiRequest<Readiness>(`/v1/organizations/${orgId}/readiness`, { token }),
    enabled: Boolean(token && orgId),
  })

  const publishOrg = useMutation({
    mutationFn: (published: boolean) =>
      apiRequest(`/v1/organizations/${orgId}`, {
        method: 'PATCH',
        token,
        body: { published },
      }),
    onSuccess: async (_d, published) => {
      setError(null)
      toast.success(published ? 'Салон опубликован' : 'Салон скрыт')
      await onChanged()
      await orgReady.refetch()
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось изменить публикацию салона')),
  })

  const addBranch = useMutation({
    mutationFn: () =>
      apiRequest(`/v1/organizations/${orgId}/branches`, {
        method: 'POST',
        token,
        body: {
          name: branchName,
          city: branchCity,
          address_line: branchAddress,
          phone: branchPhone,
        },
      }),
    onSuccess: async () => {
      setError(null)
      toast.success('Филиал создан (скрыт до публикации)')
      setBranchPhone('')
      await onChanged()
      await orgReady.refetch()
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось создать филиал')),
  })

  return (
    <div className="card stack" data-testid="settings-salon-manage">
      <div className="row between gap wrap">
        <h3>{item.organization.name}</h3>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Закрыть</button>
      </div>
      {error && <ErrorBanner error={error} />}
      {orgReady.data && (
        <div className="stack-sm">
          <p className="muted">
            Готовность салона: {orgReady.data.ready ? 'можно публиковать' : `не хватает: ${orgReady.data.missing.join(', ') || '—'}`}
          </p>
          <div className="row gap wrap">
            <button
              type="button"
              className="btn btn-primary"
              data-testid="settings-publish-org"
              disabled={publishOrg.isPending || !orgReady.data.ready || Boolean(item.organization.published)}
              onClick={() => publishOrg.mutate(true)}
            >
              Опубликовать салон
            </button>
            {item.organization.published && (
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="settings-unpublish-org"
                disabled={publishOrg.isPending}
                onClick={() => publishOrg.mutate(false)}
              >
                Скрыть салон
              </button>
            )}
          </div>
        </div>
      )}

      <h4>Филиалы</h4>
      {item.branches.length === 0 && <p className="muted">Филиалов пока нет.</p>}
      {item.branches.map((b) => (
        <BranchManageRow
          key={b.id}
          branch={b}
          token={token}
          onChanged={async () => {
            await onChanged()
            await orgReady.refetch()
          }}
        />
      ))}

      <div className="stack-sm" data-testid="settings-add-branch">
        <h4>Добавить филиал</h4>
        <div className="field">
          <label htmlFor="nb-name">Название</label>
          <input id="nb-name" value={branchName} onChange={(e) => setBranchName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="nb-city">Город</label>
          <input id="nb-city" value={branchCity} onChange={(e) => setBranchCity(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="nb-addr">Адрес</label>
          <input id="nb-addr" value={branchAddress} onChange={(e) => setBranchAddress(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="nb-phone">Телефон</label>
          <input id="nb-phone" value={branchPhone} onChange={(e) => setBranchPhone(e.target.value)} />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="settings-create-branch"
          disabled={addBranch.isPending || !branchName.trim() || !branchCity.trim() || !branchAddress.trim()}
          onClick={() => addBranch.mutate()}
        >
          Создать филиал
        </button>
      </div>
    </div>
  )
}

function BranchManageRow({
  branch,
  token,
  onChanged,
}: {
  branch: OrgItem['branches'][number]
  token: string | null | undefined
  onChanged: () => Promise<void>
}) {
  const [phone, setPhone] = useState(branch.phone || '')
  const [error, setError] = useState<string | null>(null)

  const ready = useQuery({
    queryKey: ['branch-readiness', branch.id],
    queryFn: () => apiRequest<Readiness>(`/v1/branches/${branch.id}/readiness`, { token }),
    enabled: Boolean(token && branch.id),
  })

  const savePhone = useMutation({
    mutationFn: () =>
      apiRequest(`/v1/branches/${branch.id}`, {
        method: 'PATCH',
        token,
        body: { phone },
      }),
    onSuccess: async () => {
      setError(null)
      toast.success('Телефон филиала сохранён')
      await onChanged()
      await ready.refetch()
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось сохранить телефон')),
  })

  const publish = useMutation({
    mutationFn: (published: boolean) =>
      apiRequest(`/v1/branches/${branch.id}`, {
        method: 'PATCH',
        token,
        body: { published },
      }),
    onSuccess: async (_d, published) => {
      setError(null)
      toast.success(published ? 'Филиал опубликован' : 'Филиал скрыт')
      await onChanged()
      await ready.refetch()
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось изменить публикацию филиала')),
  })

  return (
    <article className="card stack-sm" data-testid="settings-branch-row">
      <strong>{branch.name}</strong>
      <p className="muted">
        {branch.city}, {branch.address_line}
        {' · '}
        {branch.published ? 'опубликован' : 'скрыт'}
      </p>
      {error && <ErrorBanner error={error} />}
      {ready.data && !ready.data.ready && (
        <p className="muted">Не готов: {ready.data.missing.join(', ')}</p>
      )}
      <div className="field">
        <label htmlFor={`bp-${branch.id}`}>Телефон филиала</label>
        <input id={`bp-${branch.id}`} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="row gap wrap">
        <button type="button" className="btn btn-secondary" disabled={savePhone.isPending} onClick={() => savePhone.mutate()}>
          Сохранить телефон
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="settings-publish-branch"
          disabled={publish.isPending || !ready.data?.ready || Boolean(branch.published)}
          onClick={() => publish.mutate(true)}
        >
          Опубликовать филиал
        </button>
        {branch.published && (
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="settings-unpublish-branch"
            disabled={publish.isPending}
            onClick={() => publish.mutate(false)}
          >
            Скрыть филиал
          </button>
        )}
      </div>
    </article>
  )
}

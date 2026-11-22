import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { apiRequest } from '@/shared/api/client'
import { formatUserError } from '@/shared/lib/app-error'
import { useCabinet } from '@/shared/lib/cabinet'
import { useMyOrgs, type OrgItem } from '@/shared/lib/commerce'
import { CreateSalonForm, type CreateSalonPayload } from '@/shared/ui/CreateSalonForm'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { Modal } from '@/shared/ui/Modal'
import { toast } from '@/shared/ui/Toast'

const MANAGE_ORG_STORAGE_KEY = 'zb.settings-manage-org'

function readStoredManageId(): string | null {
  try {
    return sessionStorage.getItem(MANAGE_ORG_STORAGE_KEY)
  } catch {
    return null
  }
}

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
  // sessionStorage-backed: survives auth/cabinet remounts without triggering a route navigation.
  const [manageId, setManageIdState] = useState<string | null>(() => readStoredManageId())
  const setManageId = useCallback((id: string | null) => {
    setManageIdState(id)
    try {
      if (id) sessionStorage.setItem(MANAGE_ORG_STORAGE_KEY, id)
      else sessionStorage.removeItem(MANAGE_ORG_STORAGE_KEY)
    } catch {
      /* private mode */
    }
  }, [])

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

type BranchClosePreflight = {
  branch_id: string
  branch_name: string
  organization_name: string
  active: boolean
  already_closed: boolean
  future_appointments: number
  masters_affected: number
  last_active_branch: boolean
  will_unpublish_org: boolean
  contact_phone: string
  contact_source: string
  contact_display: string
  can_close: boolean
  blockers: Array<{ code: string; label: string; count: number; href?: string }>
  latest_job_id?: string
  latest_job_status?: string
  latest_job_error?: string
}

type BranchCloseJob = {
  id: string
  status: string
  error_message?: string
  org_unpublished?: boolean
  result?: { cancelled_appointments?: number }
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
  const qc = useQueryClient()
  const [phone, setPhone] = useState(branch.phone || '')
  const [error, setError] = useState<string | null>(null)
  const [closeOpen, setCloseOpen] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [closeResult, setCloseResult] = useState<BranchCloseJob | null>(null)
  /** Defer org list refresh until the close modal dismisses, so Modal local state is not wiped. */
  const [pendingListRefresh, setPendingListRefresh] = useState(false)
  const isClosed = branch.active === false

  const ready = useQuery({
    queryKey: ['branch-readiness', branch.id],
    queryFn: () => apiRequest<Readiness>(`/v1/branches/${branch.id}/readiness`, { token }),
    enabled: Boolean(token && branch.id),
    staleTime: 30_000,
  })

  // One query key for close status + modal preflight to avoid racing duplicate fetches.
  const closeInfo = useQuery({
    queryKey: ['branch-close-preflight', branch.id],
    queryFn: () => apiRequest<BranchClosePreflight>(`/v1/branches/${branch.id}/close/preflight`, { token }),
    enabled: Boolean(token && branch.id),
    staleTime: 30_000,
    // While the close modal is open, freeze the snapshot so React Query refetches
    // cannot remount modal children (checkbox/submit) mid-interaction.
    refetchOnWindowFocus: !closeOpen,
    refetchInterval: (q) => {
      if (closeOpen) return false
      return q.state.data?.latest_job_status === 'running' ? 2000 : false
    },
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

  const closeBranch = useMutation({
    mutationFn: () =>
      apiRequest<BranchCloseJob>(`/v1/branches/${branch.id}/close`, {
        method: 'POST',
        token,
        body: {},
      }),
    onSuccess: async (job) => {
      setCloseResult(job)
      setConfirmClose(false)
      // Keep Modal mounted with closeResult; refresh org list only after the user dismisses it.
      if (job.status === 'completed') {
        toast.success('Филиал закрыт')
        setPendingListRefresh(true)
        await qc.setQueryData(['branch-close-preflight', branch.id], (prev: BranchClosePreflight | undefined) =>
          prev
            ? {
                ...prev,
                active: false,
                already_closed: true,
                can_close: false,
                latest_job_status: 'completed',
                latest_job_id: job.id,
              }
            : prev,
        )
      } else if (job.status === 'failed' || job.status === 'blocked') {
        await closeInfo.refetch()
      } else if (job.status === 'running') {
        await closeInfo.refetch()
      }
    },
    onError: (e) => setError(formatUserError(e, 'Не удалось закрыть филиал')),
  })

  const jobStatus = closeResult?.status || closeInfo.data?.latest_job_status
  const needsResume = jobStatus === 'failed' || (isClosed && jobStatus === 'blocked')
  const isRunning = jobStatus === 'running' || closeBranch.isPending

  const openCloseModal = useCallback(() => {
    setError(null)
    setConfirmClose(false)
    setCloseResult(null)
    setCloseOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setCloseOpen(false)
    setConfirmClose(false)
    const shouldRefresh = pendingListRefresh || closeResult?.status === 'completed'
    setPendingListRefresh(false)
    setCloseResult(null)
    if (shouldRefresh) {
      void onChanged()
    }
  }, [onChanged, pendingListRefresh, closeResult?.status])

  const pf = closeOpen ? closeInfo.data : undefined
  const blockers = pf?.blockers ?? []
  const blocked = blockers.length > 0
  const preflightPending = closeOpen && closeInfo.isFetching && !closeInfo.data

  return (
    <article className="card stack-sm" data-testid="settings-branch-row">
      <div className="row between gap" style={{ alignItems: 'flex-start' }}>
        <div className="stack-sm" style={{ minWidth: 0, flex: 1 }}>
          <strong style={{ overflowWrap: 'anywhere' }}>{branch.name}</strong>
          <p className="muted">
            {branch.city}, {branch.address_line}
            {' · '}
            {isRunning ? 'закрытие выполняется' : isClosed || closeResult?.status === 'completed' ? 'закрыт' : branch.published ? 'опубликован' : 'скрыт'}
            {needsResume ? ' · ошибка закрытия' : ''}
          </p>
        </div>
        {(!isClosed || needsResume) && !isRunning && closeResult?.status !== 'completed' && Boolean(closeInfo.data) && (
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            data-testid="settings-close-branch"
            aria-label={needsResume ? `Повторить закрытие филиала ${branch.name}` : `Закрыть филиал ${branch.name}`}
            style={{ minWidth: 44, minHeight: 44, flexShrink: 0 }}
            onClick={openCloseModal}
          >
            ×
          </button>
        )}
      </div>
      {isRunning && (
        <p className="state-box" data-testid="branch-close-running-badge" role="status">
          Закрытие выполняется…
        </p>
      )}
      {needsResume && !isRunning && (
        <p className="state-box" data-testid="branch-close-failed-badge">
          Закрытие не завершено: {closeInfo.data?.latest_job_error || 'повторите операцию'}
        </p>
      )}
      {error && <ErrorBanner error={error} />}
      {ready.data && !ready.data.ready && !isClosed && (
        <p className="muted">Не готов: {ready.data.missing.join(', ')}</p>
      )}
      {!isClosed && closeResult?.status !== 'completed' && (
        <>
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
        </>
      )}

      <Modal
        open={closeOpen}
        onClose={closeModal}
        title="Закрытие филиала"
        size="md"
        closeOnBackdrop={!closeBranch.isPending && closeResult?.status !== 'completed'}
      >
        {preflightPending && <div className="state-box">Проверяем последствия…</div>}
        {closeInfo.isError && closeOpen && !closeResult && (
          <ErrorBanner error={closeInfo.error} fallbackTitle="Не удалось загрузить проверку" />
        )}
        {pf && !closeResult && (
          <div className="stack" data-testid="branch-close-preflight">
            <p>
              Филиал <strong style={{ overflowWrap: 'anywhere' }}>{pf.branch_name}</strong>
            </p>
            <ul className="stack-sm" style={{ margin: 0, paddingLeft: 18 }}>
              <li data-testid="branch-close-future-count">Будущих записей к отмене: {pf.future_appointments}</li>
              <li data-testid="branch-close-masters-count">Затронутых мастеров: {pf.masters_affected}</li>
              <li>Контакт для клиентов: {pf.contact_display}</li>
            </ul>
            {pf.will_unpublish_org && (
              <p className="state-box" data-testid="branch-close-last-branch">
                Это последний активный филиал — салон будет снят с публикации. История сохранится.
              </p>
            )}
            {blocked && (
              <div className="stack-sm" data-testid="branch-close-blockers">
                <p className="muted">Закрытие недоступно, пока не завершены операции:</p>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {blockers.map((b) => (
                    <li key={b.code}>
                      {b.label}: {b.count}
                      {b.href ? (
                        <>
                          {' '}
                          <Link to={b.href}>Открыть</Link>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pf.latest_job_status === 'running' && (
              <p className="state-box" data-testid="branch-close-running" role="status">
                Закрытие выполняется…
              </p>
            )}
            {(pf.latest_job_status === 'failed' || (pf.already_closed && pf.latest_job_status === 'blocked')) && (
              <p className="state-box" data-testid="branch-close-resume-hint">
                Предыдущая попытка не завершилась{pf.latest_job_error ? `: ${pf.latest_job_error}` : ''}. Можно возобновить.
              </p>
            )}
            {!blocked && pf.can_close && pf.latest_job_status !== 'running' && (
              <label className="row gap" style={{ alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  data-testid="branch-close-confirm"
                  checked={confirmClose}
                  onChange={(e) => setConfirmClose(e.target.checked)}
                  style={{ marginTop: 4, minWidth: 20, minHeight: 20 }}
                />
                <span>
                  {needsResume
                    ? 'Подтверждаю возобновление закрытия филиала.'
                    : 'Понимаю: будущие записи будут отменены, филиал станет недоступен для новых записей, данные сохранятся.'}
                </span>
              </label>
            )}
            {pf.already_closed && pf.latest_job_status === 'completed' && (
              <p className="muted">Филиал уже закрыт.</p>
            )}
          </div>
        )}
        {closeResult && (
          <div className="stack-sm" data-testid="branch-close-result">
            {closeResult.status === 'running' && (
              <p className="state-box" role="status" data-testid="branch-close-running-state">
                Закрытие выполняется…
              </p>
            )}
            {closeResult.status === 'completed' && (
              <p className="state-box success" role="status">
                Филиал закрыт
                {typeof closeResult.result?.cancelled_appointments === 'number'
                  ? `. Отменено записей: ${closeResult.result.cancelled_appointments}`
                  : ''}
                {closeResult.org_unpublished ? '. Салон снят с публикации.' : ''}
              </p>
            )}
            {closeResult.status === 'blocked' && (
              <p className="state-box">Закрытие заблокировано незавершёнными операциями.</p>
            )}
            {closeResult.status === 'failed' && (
              <ErrorBanner error={closeResult.error_message || 'Ошибка закрытия филиала'} />
            )}
          </div>
        )}
        <div className="row gap wrap" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={closeBranch.isPending}>
            {closeResult?.status === 'completed' ? 'Готово' : 'Отмена'}
          </button>
          {!closeResult && !blocked && pf && pf.can_close && pf.latest_job_status !== 'running' && (
            <button
              type="button"
              className="btn btn-primary"
              data-testid="branch-close-submit"
              disabled={!confirmClose || closeBranch.isPending}
              onClick={() => closeBranch.mutate()}
            >
              {closeBranch.isPending ? 'Закрываем…' : needsResume ? 'Возобновить закрытие' : 'Закрыть филиал'}
            </button>
          )}
        </div>
      </Modal>
    </article>
  )
}

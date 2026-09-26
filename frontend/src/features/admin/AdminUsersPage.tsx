import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { adminApi } from './api'
import { formatAdminDate, primaryRole, statusLabel } from './helpers'
import { AdminFilterBar, AdminPagination, AdminSkeleton, AdminTable, ConfirmAction, SearchField, SelectFilter } from './ui'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { ApiError } from '@/shared/api/client'

export function AdminUsersPage() {
  const { accessToken } = useAuth()
  const [params, setParams] = useSearchParams()
  const q = useQuery({
    queryKey: ['admin-users', params.toString()],
    queryFn: () => adminApi.users(accessToken, params),
    enabled: Boolean(accessToken),
  })
  const reset = () => setParams(new URLSearchParams())
  return (
    <div className="page stack admin-page">
      <h1>Пользователи</h1>
      <AdminFilterBar onReset={reset}>
        <SearchField placeholder="Имя или email" />
        <SelectFilter
          name="role"
          label="Роль"
          options={[
            { value: 'client', label: 'Клиент' },
            { value: 'master', label: 'Мастер' },
            { value: 'salon_admin', label: 'Администратор салона' },
            { value: 'supplier', label: 'Поставщик' },
            { value: 'system_admin', label: 'Платформа' },
          ]}
        />
        <SelectFilter
          name="status"
          label="Статус"
          options={[
            { value: 'active', label: 'Активен' },
            { value: 'blocked', label: 'Заблокирован' },
          ]}
        />
      </AdminFilterBar>
      {q.isError ? <ErrorBanner error={q.error} fallbackTitle="Не удалось загрузить пользователей" /> : null}
      {q.isLoading ? <AdminSkeleton /> : null}
      {q.data ? (
        <>
          <AdminTable
            emptyTitle="Пользователи не найдены"
            emptyAction={
              <button type="button" className="btn btn-ghost" onClick={reset}>
                Сбросить фильтры
              </button>
            }
            columns={[
              { key: 'name', label: 'Имя' },
              { key: 'email', label: 'Email' },
              { key: 'role', label: 'Роль' },
              { key: 'status', label: 'Статус' },
              { key: 'created', label: 'Создан', hideOnMobile: true },
            ]}
            rows={(q.data.items ?? []).map((u) => ({
              id: u.id,
              href: `/admin/users/${u.id}`,
              cells: {
                name: u.display_name,
                email: u.email ?? '—',
                role: primaryRole(u.roles),
                status: statusLabel(u.status),
                created: formatAdminDate(u.created_at),
              },
            }))}
          />
          <AdminPagination total={q.data.total} limit={q.data.limit} />
        </>
      ) : null}
    </div>
  )
}

export function AdminUserDetailPage() {
  const { id = '' } = useParams()
  const { accessToken, user } = useAuth()
  const qc = useQueryClient()
  const [action, setAction] = useState<'block' | 'unblock' | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<unknown>(null)
  const q = useQuery({ queryKey: ['admin-user', id], queryFn: () => adminApi.user(accessToken, id), enabled: Boolean(accessToken && id) })
  const orgs = useQuery({
    queryKey: ['admin-user-orgs', id],
    queryFn: () => adminApi.orgs(accessToken, new URLSearchParams({ member_user_id: id, limit: '20' })),
    enabled: Boolean(accessToken && id),
  })
  const masters = useQuery({
    queryKey: ['admin-user-masters', id],
    queryFn: () => adminApi.masters(accessToken, new URLSearchParams({ user_id: id, limit: '5' })),
    enabled: Boolean(accessToken && id),
  })
  const mutate = useMutation({
    mutationFn: async () => {
      if (action === 'block') return adminApi.blockUser(accessToken, id, reason)
      return adminApi.unblockUser(accessToken, id)
    },
    onSuccess: async () => {
      setAction(null)
      setReason('')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['admin-user', id] })
      await qc.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (e) => setError(e),
  })
  if (q.isLoading) return <div className="page"><AdminSkeleton rows={4} /></div>
  if (q.isError) return <div className="page"><ErrorBanner error={q.error} /></div>
  const u = q.data
  if (!u) return null
  const canModerate = u.id !== user?.id && !u.roles.includes('system_admin')
  return (
    <div className="page stack admin-page">
      <Link to="/admin/users">← Пользователи</Link>
      <h1>{u.display_name}</h1>
      {error ? <ErrorBanner error={error instanceof ApiError ? error : error} /> : null}
      <section className="card stack">
        <p><span className="muted">Email</span> {u.email ?? '—'}</p>
        <p><span className="muted">Роль</span> {primaryRole(u.roles)}</p>
        <p><span className="muted">Статус</span> {statusLabel(u.status)}</p>
        <p><span className="muted">Создан</span> {formatAdminDate(u.created_at)}</p>
        {u.subscription ? <p><span className="muted">Подписка</span> {u.subscription.plan} · {u.subscription.status}</p> : null}
      </section>
      {orgs.data?.items?.length ? (
        <section className="card stack">
          <h2>Организации</h2>
          {orgs.data.items.map((o) => (
            <Link key={o.id} to={`/admin/organizations/${o.id}`}>{o.name}</Link>
          ))}
        </section>
      ) : null}
      {masters.data?.items?.length ? (
        <section className="card stack">
          <h2>Профиль мастера</h2>
          {masters.data.items.map((m) => (
            <Link key={m.id} to={`/admin/masters/${m.id}`}>{m.display_name}</Link>
          ))}
        </section>
      ) : null}
      {canModerate ? (
        <div className="row gap">
          {u.status !== 'blocked' ? (
            <button type="button" className="btn btn-danger" onClick={() => setAction('block')}>Заблокировать</button>
          ) : (
            <button type="button" className="btn" onClick={() => setAction('unblock')}>Разблокировать</button>
          )}
        </div>
      ) : null}
      <ConfirmAction
        open={action === 'block'}
        title="Заблокировать пользователя"
        text="Пользователь не сможет войти, пока блокировка не будет снята."
        reason={reason}
        onReason={setReason}
        confirmLabel="Заблокировать"
        danger
        pending={mutate.isPending}
        onClose={() => setAction(null)}
        onConfirm={() => mutate.mutate()}
      />
      <ConfirmAction
        open={action === 'unblock'}
        title="Разблокировать пользователя"
        text="Пользователь снова сможет войти в систему."
        confirmLabel="Разблокировать"
        pending={mutate.isPending}
        onClose={() => setAction(null)}
        onConfirm={() => mutate.mutate()}
      />
    </div>
  )
}

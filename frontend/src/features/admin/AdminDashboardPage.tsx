import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { adminApi } from './api'
import { auditActionLabel, formatAdminDate } from './helpers'
import { AdminSkeleton } from './ui'
import { ErrorBanner } from '@/shared/ui/ErrorBanner'
import { EmptyState } from '@/shared/ui/EmptyState'

export function AdminDashboardPage() {
  const { accessToken } = useAuth()
  const users = useQuery({ queryKey: ['admin-stats-users'], queryFn: () => adminApi.userStats(accessToken), enabled: Boolean(accessToken) })
  const orgs = useQuery({ queryKey: ['admin-stats-orgs'], queryFn: () => adminApi.orgStats(accessToken), enabled: Boolean(accessToken) })
  const market = useQuery({ queryKey: ['admin-stats-market'], queryFn: () => adminApi.marketplaceStats(accessToken), enabled: Boolean(accessToken) })
  const commerce = useQuery({ queryKey: ['admin-stats-commerce'], queryFn: () => adminApi.commerceStats(accessToken), enabled: Boolean(accessToken) })
  const disputes = useQuery({ queryKey: ['admin-stats-disputes'], queryFn: () => adminApi.disputeStats(accessToken), enabled: Boolean(accessToken) })
  const audit = useQuery({
    queryKey: ['admin-audit-recent'],
    queryFn: () => adminApi.audit(accessToken, new URLSearchParams({ limit: '8' })),
    enabled: Boolean(accessToken),
  })

  const loading = users.isLoading || orgs.isLoading || market.isLoading
  const error = users.error || orgs.error || market.error || commerce.error || disputes.error

  if (loading) return <AdminSkeleton />

  return (
    <div className="page stack admin-page">
      <header className="stack-xs">
        <p className="eyebrow">Платформа</p>
        <h1>Администрирование</h1>
        <p className="muted">Обзор спорных ситуаций, каталогов и операционных данных.</p>
      </header>
      {error ? <ErrorBanner error={error} fallbackTitle="Не удалось загрузить сводку" /> : null}
      <section className="kpi-grid kpi-desktop-only admin-kpi" aria-label="Сводка">
        <Kpi to="/admin/users" label="Пользователи" value={users.data?.users_total} />
        <Kpi to="/admin/organizations" label="Активные организации" value={orgs.data?.organizations_active} />
        <Kpi to="/admin/masters" label="Мастера" value={market.data?.masters_total} />
        <Kpi to="/admin/organizations?type=supplier" label="Поставщики" value={orgs.data?.suppliers} />
        <Kpi to="/admin/products" label="Товары" value={commerce.data?.products_total} />
        <Kpi to="/admin/knowledge?status=published" label="Опубликованные статьи" value={market.data?.articles_published} />
        <Kpi to="/admin/knowledge?status=draft" label="Черновики статей" value={market.data?.articles_draft} />
        <Kpi to="/admin/disputes?status=open" label="Открытые споры" value={disputes.data?.disputes_open} />
      </section>
      <section className="kpi-grid kpi-grid-mobile admin-kpi" aria-label="Сводка">
        <Kpi to="/admin/users" label="Пользователи" value={users.data?.users_total} />
        <Kpi to="/admin/organizations" label="Организации" value={orgs.data?.organizations_active} />
        <Kpi to="/admin/disputes?status=open" label="Споры" value={disputes.data?.disputes_open} />
        <Kpi to="/admin/knowledge?status=draft" label="Черновики" value={market.data?.articles_draft} />
      </section>
      <section className="card stack">
        <div className="row between">
          <h2>Последние действия</h2>
          <Link to="/admin/audit">Журнал</Link>
        </div>
        {audit.isLoading ? <AdminSkeleton rows={3} /> : null}
        {audit.data && audit.data.items.length === 0 ? <EmptyState title="Пока нет административных действий" /> : null}
        <ul className="stack-xs admin-audit-preview">
          {audit.data?.items.map((e) => (
            <li key={e.id}>
              <span className="muted">{formatAdminDate(e.created_at)}</span>
              <span className="muted">{e.actor_user_id ? 'Администратор' : 'Система'}</span>
              <strong>{auditActionLabel(e.action)}</strong>
              <span className="muted">
                {e.entity_type} {e.entity_id ? `#${e.entity_id.slice(0, 8)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Kpi({ to, label, value }: { to: string; label: string; value?: number }) {
  return (
    <Link to={to} className="card admin-kpi-card">
      <span className="muted">{label}</span>
      <strong>{value ?? '—'}</strong>
    </Link>
  )
}

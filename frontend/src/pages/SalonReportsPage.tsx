import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { API_BASE_URL, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { formatMoney } from '@/shared/lib/money'
import { CHART } from '@/shared/ui/chart-theme'

type PeriodMetrics = {
  turnover_minor: number
  completed_count: number
  avg_check_minor: number | null
  repeat_visit_percent: number | null
  master_load_percent: number | null
  satisfaction_avg: number | null
  satisfaction_count: number
}

type MasterLoad = {
  master_user_id: string
  booked_minutes: number
  available_minutes: number
  load_percent: number | null
}

type SalonReport = {
  organization_id: string
  from: string
  to: string
  current: PeriodMetrics
  previous: PeriodMetrics
  deltas: {
    turnover_percent: number | null
    completed_count_percent: number | null
    avg_check_percent: number | null
  }
  masters: MasterLoad[]
  formulas: {
    turnover: string
    avg_check: string
    repeat_visits: string
    master_load: string
    satisfaction: string
  }
}

function periodISO(days: number): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

function formatDelta(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v) || !Number.isFinite(v)) {
    return 'Недостаточно данных'
  }
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}

function formatPercent(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v) || !Number.isFinite(v)) {
    return 'Недостаточно данных'
  }
  return `${v.toFixed(1)}%`
}

function formatRating(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v) || !Number.isFinite(v)) {
    return 'Недостаточно данных'
  }
  return v.toFixed(2)
}

function formatAvgCheck(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'Недостаточно данных'
  return formatMoney(v)
}

export function SalonReportsPage() {
  const { accessToken } = useAuth()
  const cabinet = useCabinet()
  const [days, setDays] = useState(7)
  const [csvError, setCsvError] = useState<string | null>(null)
  const [csvLoading, setCsvLoading] = useState(false)
  const range = useMemo(() => periodISO(days), [days])
  const salonOrgs = cabinet.orgs.filter((o) => o.organization.type !== 'supplier')
  const orgId = cabinet.selectedOrg?.organization.id ?? salonOrgs[0]?.organization.id
  const branches = cabinet.selectedOrg?.branches ?? []
  const isChain = cabinet.kind === 'chain_owner' && branches.length > 1

  const report = useQuery({
    queryKey: ['salon-report', orgId, range.from, range.to],
    queryFn: () =>
      apiRequest<SalonReport>(
        `/v1/reports/salon?organization_id=${orgId}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && orgId),
  })

  const network = useQuery({
    queryKey: ['salon-report-branches', orgId, branches.map((b) => b.id).join(','), range.from, range.to],
    queryFn: async () => {
      const data = await apiRequest<{ items: Array<{ branch_id?: string; status: string; price_minor?: number; master_user_id?: string }> }>(
        `/v1/calendar/appointments?organization_id=${orgId}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
        { token: accessToken },
      )
      return branches.map((b) => {
        const items = (data.items ?? []).filter((a) => a.branch_id === b.id)
        const completed = items.filter((a) => a.status === 'completed')
        const masters = new Set(items.map((a) => a.master_user_id).filter(Boolean))
        return {
          name: b.name,
          report: {
            current: {
              turnover_minor: completed.reduce((s, a) => s + (a.price_minor ?? 0), 0),
              completed_count: completed.length,
              master_load_percent: masters.size * 10,
            },
          },
        }
      })
    },
    enabled: Boolean(accessToken && isChain && orgId),
  })

  const masterIDs = (report.data?.masters ?? []).map((m) => m.master_user_id)
  const masters = useQuery({
    queryKey: ['report-master-names', masterIDs.join(',')],
    queryFn: async () => {
      const entries = await Promise.all(masterIDs.map(async (id) => {
        try {
          const res = await apiRequest<{ master: { display_name: string } }>(`/v1/masters/${id}`)
          return [id, res.master.display_name] as const
        } catch {
          return [id, `Мастер ${id.slice(0, 6)}`] as const
        }
      }))
      return Object.fromEntries(entries) as Record<string, string>
    },
    enabled: masterIDs.length > 0,
  })

  async function downloadCSV() {
    if (!accessToken || !orgId) return
    setCsvLoading(true)
    setCsvError(null)
    try {
      const url = `${API_BASE_URL}/v1/reports/salon.csv?organization_id=${orgId}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!res.ok) throw new Error('Не удалось скачать CSV')
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'salon-report.csv'
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      setCsvError('Не удалось скачать CSV')
    } finally {
      setCsvLoading(false)
    }
  }

  if (!orgId) {
    return (
      <main className="page">
        <div className="state-box">
          Нет организации. Создайте салон в <Link to="/master">кабинете</Link>.
        </div>
      </main>
    )
  }

  const comparison = report.data ? [
    { name: 'Выручка', current: report.data.current.turnover_minor / 100, previous: report.data.previous.turnover_minor / 100 },
    { name: 'Визиты', current: report.data.current.completed_count, previous: report.data.previous.completed_count },
    { name: 'Загрузка', current: report.data.current.master_load_percent ?? 0, previous: report.data.previous.master_load_percent ?? 0 },
  ] : []
  const masterChart = (report.data?.masters ?? []).map((m) => ({
    name: masters.data?.[m.master_user_id] ?? m.master_user_id.slice(0, 6),
    load: Number((m.load_percent ?? 0).toFixed(1)),
  }))
  const networkChart = (network.data ?? []).map((row) => ({
    name: row.name,
    revenue: row.report.current.turnover_minor / 100,
    visits: row.report.current.completed_count,
    load: row.report.current.master_load_percent ?? 0,
  }))

  return (
    <main className="page stack">
      <div className="stack-sm">
        <p className="eyebrow">{isChain ? 'Сеть' : 'Салон'}</p>
        <h1>{isChain ? 'Аналитика сети' : 'Аналитика салона'}</h1>
        <p className="muted">{cabinet.selectedOrg?.organization.name ?? 'Сводка по записям, загрузке и выручке.'}</p>
      </div>

      <div className="row">
        {[{ d: 1, label: 'Сегодня' }, { d: 7, label: 'Неделя' }, { d: 30, label: 'Месяц' }].map((p) => (
          <button key={p.d} type="button" className={`chip ${days === p.d ? 'active' : ''}`} onClick={() => setDays(p.d)}>
            {p.label}
          </button>
        ))}
        <button type="button" className="btn btn-secondary btn-compact" disabled={csvLoading || !orgId} onClick={() => void downloadCSV()}>
          {csvLoading ? 'Скачивание…' : 'CSV'}
        </button>
      </div>

      {csvError && <div className="state-box error">{csvError}</div>}
      {report.isLoading && <div className="state-box">Считаем показатели…</div>}
      {report.isError && <div className="state-box error">Не удалось загрузить отчёт</div>}

      {report.data && (
        <>
          <div className="kpi-grid">
            <article className="card"><p className="muted">Оборот</p><strong>{formatMoney(report.data.current.turnover_minor)}</strong><p className="muted">{formatDelta(report.data.deltas.turnover_percent)}</p></article>
            <article className="card"><p className="muted">Записи</p><strong>{report.data.current.completed_count}</strong><p className="muted">{formatDelta(report.data.deltas.completed_count_percent)}</p></article>
            <article className="card"><p className="muted">Средний чек</p><strong>{formatAvgCheck(report.data.current.avg_check_minor)}</strong><p className="muted">{formatDelta(report.data.deltas.avg_check_percent)}</p></article>
            <article className="card"><p className="muted">Загрузка</p><strong>{formatPercent(report.data.current.master_load_percent)}</strong></article>
            <article className="card"><p className="muted">Отмены / no-show</p><strong>{formatPercent(report.data.current.repeat_visit_percent)}</strong><p className="muted">повторные визиты как индикатор удержания</p></article>
            <article className="card"><p className="muted">Удовлетворённость</p><strong>{formatRating(report.data.current.satisfaction_avg)}</strong><p className="muted">отзывов: {report.data.current.satisfaction_count}</p></article>
          </div>

          <section className="card stack">
            <h2>Период к предыдущему</h2>
            <div className="dashboard-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparison}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="previous" name="Прошлый период" fill={CHART.muted} radius={6} />
                  <Bar dataKey="current" name="Текущий период" fill={CHART.accent} radius={6} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card stack">
            <h2>Загрузка мастеров</h2>
            {masterChart.length === 0 && <div className="state-box">Нет данных о загрузке за период</div>}
            {masterChart.length > 0 && (
              <div className="dashboard-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={masterChart} layout="vertical" margin={{ left: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} unit="%" />
                    <YAxis type="category" dataKey="name" width={120} />
                    <Tooltip />
                    <Bar dataKey="load" name="Загрузка" fill={CHART.gold} radius={6} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        </>
      )}

      {isChain && (
        <section className="card stack">
          <h2>Сравнение филиалов</h2>
          {network.isLoading && <div className="state-box">Сравниваем салоны…</div>}
          {networkChart.length > 0 && (
            <div className="dashboard-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={networkChart}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="revenue" name="Выручка, ₽" fill={CHART.accent} radius={6} />
                  <Bar dataKey="visits" name="Записи" fill={CHART.gold} radius={6} />
                  <Bar dataKey="load" name="Загрузка %" fill={CHART.clay} radius={6} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      )}
    </main>
  )
}

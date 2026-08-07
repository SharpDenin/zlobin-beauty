import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { API_BASE_URL, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'

type OrgItem = {
  organization: { id: string; name: string; type: string }
}

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
  const [days, setDays] = useState(7)
  const [csvError, setCsvError] = useState<string | null>(null)
  const [csvLoading, setCsvLoading] = useState(false)
  const range = useMemo(() => periodISO(days), [days])

  const orgs = useQuery({
    queryKey: ['orgs-mine'],
    queryFn: () => apiRequest<{ items: OrgItem[] }>('/v1/organizations/mine', { token: accessToken }),
    enabled: Boolean(accessToken),
  })
  const orgId = orgs.data?.items[0]?.organization.id

  const report = useQuery({
    queryKey: ['salon-report', orgId, range.from, range.to],
    queryFn: () =>
      apiRequest<SalonReport>(
        `/v1/reports/salon?organization_id=${orgId}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && orgId),
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

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (!orgId) {
    return (
      <main className="page">
        <div className="state-box">
          Нет организации. Создайте салон в <Link to="/master">кабинете</Link>.
        </div>
      </main>
    )
  }

  const f = report.data?.formulas

  return (
    <main className="page stack">
      <h1>Отчёты салона</h1>
      <p className="muted">
        KPI по завершённым визитам за выбранный период. Сравнение с предыдущим равным интервалом.
      </p>

      <div className="row">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            type="button"
            className={`btn ${days === d ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setDays(d)}
          >
            {d} дн.
          </button>
        ))}
        <button
          type="button"
          className="btn btn-secondary"
          disabled={csvLoading || !orgId}
          onClick={() => void downloadCSV()}
        >
          {csvLoading ? 'Скачивание…' : 'CSV'}
        </button>
        <Link className="btn btn-secondary" to="/master">Кабинет</Link>
        <Link className="btn btn-secondary" to="/warehouse">Склад</Link>
      </div>

      {csvError && <div className="state-box error">{csvError}</div>}
      {report.isLoading && <div className="state-box">Считаем показатели…</div>}
      {report.isError && <div className="state-box error">Не удалось загрузить отчёт</div>}

      {report.data && (
        <>
          <div className="kpi-grid">
            <article className="card">
              <p className="muted">Оборот</p>
              <strong>{formatMoney(report.data.current.turnover_minor)}</strong>
              <p className="muted">к пред. периоду: {formatDelta(report.data.deltas.turnover_percent)}</p>
              {f && <p className="muted" style={{ fontSize: '0.85em' }}>{f.turnover}</p>}
            </article>
            <article className="card">
              <p className="muted">Завершённых визитов</p>
              <strong>{report.data.current.completed_count}</strong>
              <p className="muted">к пред. периоду: {formatDelta(report.data.deltas.completed_count_percent)}</p>
            </article>
            <article className="card">
              <p className="muted">Средний чек</p>
              <strong>{formatAvgCheck(report.data.current.avg_check_minor)}</strong>
              <p className="muted">к пред. периоду: {formatDelta(report.data.deltas.avg_check_percent)}</p>
              {f && <p className="muted" style={{ fontSize: '0.85em' }}>{f.avg_check}</p>}
            </article>
            <article className="card">
              <p className="muted">Повторные визиты</p>
              <strong>{formatPercent(report.data.current.repeat_visit_percent)}</strong>
              {f && <p className="muted" style={{ fontSize: '0.85em' }}>{f.repeat_visits}</p>}
            </article>
            <article className="card">
              <p className="muted">Загрузка мастеров</p>
              <strong>{formatPercent(report.data.current.master_load_percent)}</strong>
              {f && <p className="muted" style={{ fontSize: '0.85em' }}>{f.master_load}</p>}
            </article>
            <article className="card">
              <p className="muted">Удовлетворённость</p>
              <strong>{formatRating(report.data.current.satisfaction_avg)}</strong>
              <p className="muted">отзывов: {report.data.current.satisfaction_count}</p>
              {f && <p className="muted" style={{ fontSize: '0.85em' }}>{f.satisfaction}</p>}
            </article>
          </div>

          <section className="card stack">
            <h2>Загрузка по мастерам</h2>
            {report.data.masters.length === 0 && (
              <div className="state-box">Нет данных о загрузке за период</div>
            )}
            <div className="list">
              {report.data.masters.map((m) => (
                <article key={m.master_user_id} className="list-item">
                  <div className="row between">
                    <strong className="muted">{m.master_user_id.slice(0, 8)}…</strong>
                    <span>{formatPercent(m.load_percent)}</span>
                  </div>
                  <p className="muted">
                    Забронировано {m.booked_minutes} мин · доступно {m.available_minutes} мин
                  </p>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  )
}

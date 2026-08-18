import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { fetchPickupBranches, useSupplierOrg } from '@/shared/lib/commerce'
import { formatMoney } from '@/shared/lib/money'
import { Hint } from '@/shared/ui/Hint'

type Rep = {
  id: string
  city?: string
  territory?: string
  active?: boolean
  user_id?: string
  display_name?: string
  email?: string
  tasks_today?: number
  tasks_done?: number
  tasks_overdue?: number
  open_tasks?: number
}

type Analytics = {
  representatives?: Array<{
    user_id: string
    orders: number
    collected_minor: number
    remaining_minor: number
    deliveries_today?: number
    unfinished_deliveries?: number
  }>
}

const TASK_TYPES = [
  { id: 'salon_visit', label: 'Визит в салон' },
  { id: 'delivery_support', label: 'Сопровождение доставки' },
  { id: 'payment_collection', label: 'Сбор оплаты' },
  { id: 'commercial_visit', label: 'Коммерческий визит' },
  { id: 'other', label: 'Другое' },
]

function initials(name?: string) {
  const parts = (name || 'П').trim().split(/\s+/)
  return ((parts[0]?.[0] || 'П') + (parts[1]?.[0] || '')).toUpperCase()
}

export function SupplierTeamPage() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const { supplierOrgId, orgs } = useSupplierOrg()
  const [email, setEmail] = useState('')
  const [city, setCity] = useState('Красноярск')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [taskTitle, setTaskTitle] = useState('Визит в салон')
  const [taskKind, setTaskKind] = useState('salon_visit')
  const [taskDate, setTaskDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [taskTime, setTaskTime] = useState('10:00')
  const [taskPriority, setTaskPriority] = useState('normal')
  const [taskComment, setTaskComment] = useState('')
  const [taskExpected, setTaskExpected] = useState('')
  const [taskSalon, setTaskSalon] = useState('')
  const [salonQ, setSalonQ] = useState('')

  const reps = useQuery({
    queryKey: ['supplier-reps', supplierOrgId],
    queryFn: () => apiRequest<{ items: Rep[] }>(`/v1/organizations/${supplierOrgId}/representatives`, { token: accessToken }),
    enabled: Boolean(accessToken && supplierOrgId),
  })
  const analytics = useQuery({
    queryKey: ['supplier-analytics-team', supplierOrgId],
    queryFn: () =>
      apiRequest<Analytics>(`/v1/commerce/supplier/analytics?organization_id=${supplierOrgId}&period=month`, { token: accessToken }),
    enabled: Boolean(accessToken && supplierOrgId),
  })
  const salons = useQuery({
    queryKey: ['pickup-branches-team'],
    queryFn: () => fetchPickupBranches(accessToken),
    enabled: Boolean(accessToken),
  })
  const filteredSalons = useMemo(() => {
    const q = salonQ.trim().toLowerCase()
    return (salons.data ?? []).filter((b) => !q || `${b.name} ${b.city} ${b.address_line ?? ''}`.toLowerCase().includes(q))
  }, [salons.data, salonQ])

  const create = useMutation({
    mutationFn: async () => {
      const login = await apiRequest<{ user: { id: string; display_name?: string; email?: string } }>('/v1/auth/lookup', { token: accessToken, body: { email } }).catch(() => null)
      const userId = login?.user?.id
      if (!userId) {
        throw new ApiError('Сначала зарегистрируйте представителя', 'validation_error', 400)
      }
      return apiRequest(`/v1/organizations/${supplierOrgId}/representatives`, {
        token: accessToken,
        body: {
          user_id: userId,
          city,
          territory: city,
          display_name: login?.user?.display_name,
          email: login?.user?.email || email,
        },
      })
    },
    onSuccess: async () => {
      setError(null)
      setOk('Представитель назначен')
      setEmail('')
      await qc.invalidateQueries({ queryKey: ['supplier-reps'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось назначить'),
  })

  const createTask = useMutation({
    mutationFn: () =>
      apiRequest(`/v1/organizations/${supplierOrgId}/tasks`, {
        token: accessToken,
        body: {
          representative_id: openId,
          title: taskTitle.trim(),
          kind: taskKind,
          description: taskComment.trim(),
          expected_result: taskExpected.trim() || undefined,
          branch_id: taskSalon || undefined,
          due_at: new Date(`${taskDate}T${taskTime}:00`).toISOString(),
          priority: taskPriority,
        },
      }),
    onSuccess: async () => {
      setOk('Задача назначена')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['supplier-reps'] })
      await qc.invalidateQueries({ queryKey: ['supplier-tasks'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось создать задачу'),
  })

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>

  const items = reps.data?.items ?? []
  const loaded = items.filter((r) => (r.open_tasks ?? 0) >= 3 || (r.tasks_today ?? 0) >= 2)
  const withOverdue = items.filter((r) => (r.tasks_overdue ?? 0) > 0)

  return (
    <main className="page stack">
      <div className="stack-sm">
        <p className="eyebrow">Поставщик</p>
        <h1>Представители <Hint id="supplier-reps" title="Команда">Карточки представителей и задачи. Мониторинг — по человеку, не по UUID.</Hint></h1>
        <p className="muted">Загрузка, просрочки, доставки и деньги по каждому сотруднику.</p>
      </div>
      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      <section className="card stack">
        <h2>Мониторинг</h2>
        <div className="kpi-grid">
          <article className="card stack-sm"><span className="muted">В команде</span><strong>{items.length}</strong></article>
          <article className="card stack-sm"><span className="muted">Загружены</span><strong>{loaded.length}</strong></article>
          <article className="card stack-sm"><span className="muted">С просрочками</span><strong>{withOverdue.length}</strong></article>
        </div>
        {items.map((r) => {
          const stats = (analytics.data?.representatives ?? []).find((x) => x.user_id === r.user_id)
          return (
            <article key={r.id} className="list-item row between">
              <div>
                <strong>{r.display_name || r.email || r.city}</strong>
                <p className="muted">
                  {r.city} · задач сегодня {r.tasks_today ?? 0} · просрочено {r.tasks_overdue ?? 0} · доставок {stats?.deliveries_today ?? 0} · незавершено {stats?.unfinished_deliveries ?? 0}
                </p>
              </div>
              <span>собрано {formatMoney(stats?.collected_minor ?? 0)}</span>
            </article>
          )
        })}
      </section>

      <section className="card stack">
        <h2>Назначить</h2>
        <div className="field"><label>Email аккаунта</label><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="rep1@demo.local" /></div>
        <div className="field"><label>Город</label><input value={city} onChange={(e) => setCity(e.target.value)} /></div>
        <button className="btn btn-primary" type="button" disabled={create.isPending} onClick={() => create.mutate()}>Назначить</button>
      </section>

      <div className="kb-grid">
        {items.map((r) => {
          const stats = (analytics.data?.representatives ?? []).find((x) => x.user_id === r.user_id)
          const name = r.display_name || r.email || r.city || 'Представитель'
          return (
            <article key={r.id} className="kb-card">
              <div className="row between">
                <div className="row">
                  <span className="avatar-chip">{initials(name)}</span>
                  <div>
                    <strong>{name}</strong>
                    <p className="muted">{r.city || 'Город не указан'} · {r.territory || 'территория'}</p>
                  </div>
                </div>
                <span className={`badge ${r.active === false ? 'badge-default' : 'badge-success'}`}>{r.active === false ? 'Неактивен' : 'Активен'}</span>
              </div>
              <p>Задач сегодня: {r.tasks_today ?? 0}</p>
              <p>Доставок сегодня: {stats?.deliveries_today ?? 0}</p>
              <p>Выполнено: {r.tasks_done ?? 0} · просрочено: {r.tasks_overdue ?? 0}</p>
              <p>К получению: {formatMoney(stats?.remaining_minor ?? 0)}</p>
              <div className="row">
                <Link className="btn btn-primary btn-compact" to={`/supplier/team/${r.id}`}>Открыть</Link>
                <button className="btn btn-secondary btn-compact" type="button" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                  Создать задачу
                </button>
              </div>
              {openId === r.id && (
                <div className="stack-sm">
                  <div className="field">
                    <label htmlFor={`task-title-${r.id}`}>Название</label>
                    <input id={`task-title-${r.id}`} value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor={`task-kind-${r.id}`}>Тип</label>
                    <select id={`task-kind-${r.id}`} value={taskKind} onChange={(e) => setTaskKind(e.target.value)}>
                      {TASK_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`task-salon-q-${r.id}`}>Салон</label>
                    <input id={`task-salon-q-${r.id}`} value={salonQ} onChange={(e) => setSalonQ(e.target.value)} placeholder="Поиск салона" />
                    <select id={`task-salon-${r.id}`} value={taskSalon} onChange={(e) => setTaskSalon(e.target.value)} aria-label="Выбор салона">
                      <option value="">Выберите салон</option>
                      {filteredSalons.map((b) => (
                        <option key={b.id} value={b.id}>{b.name} · {b.city}</option>
                      ))}
                    </select>
                  </div>
                  <div className="row">
                    <div className="field">
                      <label htmlFor={`task-date-${r.id}`}>Дата</label>
                      <input id={`task-date-${r.id}`} type="date" value={taskDate} onChange={(e) => setTaskDate(e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor={`task-time-${r.id}`}>Время</label>
                      <input id={`task-time-${r.id}`} type="time" value={taskTime} onChange={(e) => setTaskTime(e.target.value)} />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor={`task-priority-${r.id}`}>Приоритет</label>
                    <select id={`task-priority-${r.id}`} value={taskPriority} onChange={(e) => setTaskPriority(e.target.value)}>
                      <option value="low">Низкий</option>
                      <option value="normal">Обычный</option>
                      <option value="high">Высокий</option>
                      <option value="urgent">Срочный</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`task-desc-${r.id}`}>Описание</label>
                    <input id={`task-desc-${r.id}`} value={taskComment} onChange={(e) => setTaskComment(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor={`task-expected-${r.id}`}>Ожидаемый результат</label>
                    <input id={`task-expected-${r.id}`} value={taskExpected} onChange={(e) => setTaskExpected(e.target.value)} placeholder="необязательно" />
                  </div>
                  <button className="btn btn-primary" type="button" disabled={createTask.isPending} onClick={() => createTask.mutate()}>Создать задачу</button>
                </div>
              )}
            </article>
          )
        })}
      </div>
      {items.length === 0 && <div className="empty-state"><h2>Пока никого нет</h2></div>}
    </main>
  )
}

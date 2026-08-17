import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { fetchPickupBranches, useSupplierOrg } from '@/shared/lib/commerce'
import { formatMoney } from '@/shared/lib/money'

type Rep = {
  id: string
  city?: string
  territory?: string
  active?: boolean
  user_id?: string
  display_name?: string
}

type Analytics = {
  representatives?: Array<{ user_id: string; orders: number; collected_minor: number; remaining_minor: number }>
}

type Task = { id: string; title: string; status: string; priority?: string; representative_id?: string }

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
  const [taskDate, setTaskDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [taskPriority, setTaskPriority] = useState('normal')
  const [taskComment, setTaskComment] = useState('')
  const [taskSalon, setTaskSalon] = useState('')

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
  const tasks = useQuery({
    queryKey: ['supplier-tasks', supplierOrgId],
    queryFn: () => apiRequest<{ items: Task[] }>(`/v1/organizations/${supplierOrgId}/tasks`, { token: accessToken }),
    enabled: Boolean(accessToken && supplierOrgId),
  })
  const salons = useQuery({
    queryKey: ['pickup-branches-team'],
    queryFn: () => fetchPickupBranches(accessToken),
    enabled: Boolean(accessToken),
  })

  const create = useMutation({
    mutationFn: async () => {
      const login = await apiRequest<{ user: { id: string } }>('/v1/auth/lookup', { token: accessToken, body: { email } }).catch(() => null)
      const userId = login?.user?.id
      if (!userId) {
        throw new ApiError('Сначала зарегистрируйте представителя', 'validation_error', 400)
      }
      return apiRequest(`/v1/organizations/${supplierOrgId}/representatives`, {
        token: accessToken,
        body: { user_id: userId, city, territory: city },
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
          description: taskComment.trim(),
          branch_id: taskSalon || undefined,
          due_at: new Date(`${taskDate}T10:00:00`).toISOString(),
          priority: taskPriority,
        },
      }),
    onSuccess: async () => {
      setOk('Задача назначена')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['supplier-tasks'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось создать задачу'),
  })

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>

  return (
    <main className="page stack">
      <h1>Команда представителей</h1>
      <p className="muted">Карточки с городом, задачами и деньгами. Можно назначить визит в салон без UUID.</p>
      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}
      <section className="card stack">
        <h2>Назначить</h2>
        <div className="field"><label>Email аккаунта</label><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="rep1@demo.local" /></div>
        <div className="field"><label>Город</label><input value={city} onChange={(e) => setCity(e.target.value)} /></div>
        <button className="btn btn-primary" type="button" disabled={create.isPending} onClick={() => create.mutate()}>Назначить</button>
      </section>
      <div className="kb-grid">
        {(reps.data?.items ?? []).map((r) => {
          const stats = (analytics.data?.representatives ?? []).find((x) => x.user_id === r.user_id)
          const todayTasks = (tasks.data?.items ?? []).filter((t) => t.representative_id === r.id)
          return (
            <article key={r.id} className="kb-card">
              <div className="row between">
                <strong>{r.display_name || r.city || 'Представитель'}</strong>
                <span className={`badge ${r.active === false ? 'badge-default' : 'badge-success'}`}>{r.active === false ? 'Неактивен' : 'Активен'}</span>
              </div>
              <p className="muted">{r.city || 'Город не указан'} · {r.territory || 'территория'}</p>
              <p>Задач: {todayTasks.length}</p>
              <p>Собрано / ожидается: {formatMoney(stats?.collected_minor ?? 0)} / {formatMoney(stats?.remaining_minor ?? 0)}</p>
              <button className="btn btn-secondary btn-compact" type="button" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                {openId === r.id ? 'Скрыть' : 'Открыть'}
              </button>
              {openId === r.id && (
                <div className="stack-sm">
                  <h3>Новая задача / визит</h3>
                  <div className="field"><label>Название</label><input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} /></div>
                  <div className="field">
                    <label>Салон</label>
                    <select value={taskSalon} onChange={(e) => setTaskSalon(e.target.value)}>
                      <option value="">Выберите салон</option>
                      {(salons.data ?? []).map((b) => (
                        <option key={b.id} value={b.id}>{b.name} · {b.city}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field"><label>Дата</label><input type="date" value={taskDate} onChange={(e) => setTaskDate(e.target.value)} /></div>
                  <div className="field">
                    <label>Приоритет</label>
                    <select value={taskPriority} onChange={(e) => setTaskPriority(e.target.value)}>
                      <option value="low">Низкий</option>
                      <option value="normal">Обычный</option>
                      <option value="high">Высокий</option>
                    </select>
                  </div>
                  <div className="field"><label>Комментарий</label><input value={taskComment} onChange={(e) => setTaskComment(e.target.value)} /></div>
                  <button className="btn btn-primary" type="button" disabled={createTask.isPending} onClick={() => createTask.mutate()}>Создать задачу</button>
                  <h3>Задачи</h3>
                  {todayTasks.length === 0 && <p className="muted">Нет задач</p>}
                  {todayTasks.map((t) => (
                    <p key={t.id}>{t.title} · {t.status} · {t.priority}</p>
                  ))}
                </div>
              )}
            </article>
          )
        })}
      </div>
      {reps.data && reps.data.items.length === 0 && <div className="empty-state"><h2>Пока никого нет</h2></div>}
    </main>
  )
}

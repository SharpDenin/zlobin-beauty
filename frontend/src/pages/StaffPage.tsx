import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, apiRequest } from '@/shared/api/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCabinet } from '@/shared/lib/cabinet'
import { useBuyerOrg } from '@/shared/lib/commerce'
import { statusBadgeClass } from '@/shared/lib/status'
import { Hint } from '@/shared/ui/Hint'

type Member = { id: string; user_id?: string; role: string; status: string }
type HoursItem = { weekday: number; start_minute: number; end_minute: number }

const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

function minutesToTime(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
function timeToMinutes(v: string) {
  const [h, m] = v.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function StaffPage() {
  const { accessToken } = useAuth()
  const qc = useQueryClient()
  const cabinet = useCabinet()
  const { buyerOrgId, buyerOrg, orgs } = useBuyerOrg()
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('master')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [scheduleUserId, setScheduleUserId] = useState<string | null>(null)
  const [hoursDraft, setHoursDraft] = useState<Array<{ weekday: number; start: string; end: string; enabled: boolean }>>(
    [1, 2, 3, 4, 5].map((d) => ({ weekday: d, start: '10:00', end: '19:00', enabled: true })),
  )
  const [dayOff, setDayOff] = useState('')

  const staff = useQuery({
    queryKey: ['staff', buyerOrgId],
    queryFn: () => apiRequest<{ items: Member[] }>(`/v1/organizations/${buyerOrgId}/staff`, { token: accessToken }),
    enabled: Boolean(accessToken && buyerOrgId),
  })

  const names = useQuery({
    queryKey: ['staff-names', (staff.data?.items ?? []).map((m) => m.user_id).join(',')],
    queryFn: async () => {
      const entries = await Promise.all((staff.data?.items ?? []).map(async (m) => {
        if (!m.user_id) return [m.id, m.role] as const
        try {
          const res = await apiRequest<{ master: { display_name: string; branch_id?: string } }>(`/v1/masters/${m.user_id}`)
          return [m.user_id, res.master.display_name, res.master.branch_id] as const
        } catch {
          return [m.user_id, m.role === 'admin' ? 'Администратор' : 'Сотрудник'] as const
        }
      }))
      return entries
    },
    enabled: (staff.data?.items ?? []).length > 0,
  })

  const nameByUser = useMemo(() => {
    const map: Record<string, string> = {}
    for (const row of names.data ?? []) map[row[0]] = String(row[1])
    return map
  }, [names.data])
  const branchByUser = useMemo(() => {
    const map: Record<string, string> = {}
    for (const row of names.data ?? []) {
      if (row.length > 2 && row[2]) map[row[0]] = String(row[2])
    }
    return map
  }, [names.data])

  const selectedBranchId = cabinet.selectedBranch?.id
  const visibleStaff = (staff.data?.items ?? []).filter((m) => {
    if (cabinet.kind !== 'chain_owner' || !selectedBranchId) return true
    if (m.role !== 'master') return true
    const bid = m.user_id ? branchByUser[m.user_id] : ''
    return !bid || bid === selectedBranchId
  })

  const hoursQ = useQuery({
    queryKey: ['staff-hours', buyerOrgId, scheduleUserId],
    queryFn: () =>
      apiRequest<{ items: HoursItem[] }>(
        `/v1/calendar/working-hours?organization_id=${buyerOrgId}&master_user_id=${scheduleUserId}`,
        { token: accessToken },
      ),
    enabled: Boolean(accessToken && buyerOrgId && scheduleUserId),
  })

  const saveHours = useMutation({
    mutationFn: () =>
      apiRequest(`/v1/calendar/working-hours?organization_id=${buyerOrgId}&master_user_id=${scheduleUserId}`, {
        method: 'PUT',
        token: accessToken,
        body: {
          items: hoursDraft.filter((h) => h.enabled).map((h) => ({
            weekday: h.weekday,
            start_minute: timeToMinutes(h.start),
            end_minute: timeToMinutes(h.end),
          })),
        },
      }),
    onSuccess: async () => {
      setOk('Расписание сохранено')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['staff-hours'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось сохранить расписание'),
  })

  const saveDayOff = useMutation({
    mutationFn: () =>
      apiRequest(`/v1/calendar/schedule-exceptions?organization_id=${buyerOrgId}&master_user_id=${scheduleUserId}`, {
        method: 'PUT',
        token: accessToken,
        body: { items: [{ day: dayOff, is_day_off: true, note: 'Выходной' }] },
      }),
    onSuccess: () => { setOk('Выходной добавлен'); setError(null) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось добавить выходной'),
  })

  const invite = useMutation({
    mutationFn: async () => {
      const lookup = await apiRequest<{ user: { id: string } }>('/v1/auth/lookup', {
        token: accessToken,
        body: { email: inviteEmail.trim() },
      })
      return apiRequest(`/v1/organizations/${buyerOrgId}/staff`, {
        token: accessToken,
        body: { user_id: lookup.user.id, role: inviteRole },
      })
    },
    onSuccess: async () => {
      setOk('Сотрудник добавлен')
      setError(null)
      setInviteEmail('')
      await qc.invalidateQueries({ queryKey: ['staff'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось пригласить'),
  })

  const disable = useMutation({
    mutationFn: (userId: string) =>
      apiRequest(`/v1/organizations/${buyerOrgId}/staff/disable`, {
        token: accessToken,
        body: { user_id: userId },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['staff'] })
    },
  })

  useEffect(() => {
    const items = hoursQ.data?.items
    if (!items) return
    setHoursDraft([1, 2, 3, 4, 5, 6, 0].map((weekday) => {
      const found = items.find((h) => h.weekday === weekday)
      return found
        ? { weekday, start: minutesToTime(found.start_minute), end: minutesToTime(found.end_minute), enabled: true }
        : { weekday, start: '10:00', end: '19:00', enabled: false }
    }))
  }, [hoursQ.data])

  if (orgs.isLoading) return <main className="page"><div className="state-box">Загрузка…</div></main>
  if (!buyerOrgId) return <main className="page"><div className="empty-state"><h2>Нужен салон</h2></div></main>

  return (
    <main className="page stack">
      <h1>Команда салона <Hint id="owner-staff" title="Команда">Приглашайте мастеров и администраторов. Расписание сотрудника открывается здесь, без входа в чужой кабинет.</Hint></h1>
      <p className="muted" data-testid="staff-branch-context">{buyerOrg?.organization.name}{cabinet.selectedBranch ? ` · ${cabinet.selectedBranch.name}` : ''}</p>
      {cabinet.can('salon_settings') && (
        <p><Link to="/salon/settings">Настройки салона и контакты клиентов</Link></p>
      )}
      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}
      <section className="card stack">
        <h2>Добавить сотрудника</h2>
        <p className="muted">Приглашение по email уже зарегистрированного пользователя.</p>
        <div className="field">
          <label htmlFor="invite-email">Email</label>
          <input id="invite-email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="admin1@demo.local" />
        </div>
        <div className="field">
          <label htmlFor="invite-role">Роль</label>
          <select id="invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="master">Мастер</option>
            <option value="admin">Администратор</option>
          </select>
        </div>
        <button className="btn btn-primary" type="button" disabled={invite.isPending || inviteEmail.trim().length < 5} onClick={() => invite.mutate()}>
          Пригласить
        </button>
      </section>
      <div className="list">
        {visibleStaff.map((m) => (
          <article key={m.id} className="list-item row between">
            <div>
              <strong>{nameByUser[m.user_id ?? ''] || (m.role === 'owner' ? 'Владелец' : m.role === 'admin' ? 'Администратор' : 'Мастер')}</strong>
              <p className="muted">
                {m.role === 'owner' ? 'Владелец' : m.role === 'admin' ? 'Администратор' : 'Мастер'}
                {' · '}
                <span className={`badge ${statusBadgeClass(m.status)}`}>{m.status === 'active' ? 'Активен' : 'Отключён'}</span>
              </p>
            </div>
            <div className="row">
              {m.role === 'master' && m.user_id && (
                <button className="btn btn-secondary btn-compact" type="button" onClick={() => setScheduleUserId(m.user_id!)}>Расписание</button>
              )}
              {m.status === 'active' && m.role !== 'owner' && m.user_id && (
                <button className="btn btn-secondary btn-compact" type="button" onClick={() => disable.mutate(m.user_id!)}>Отключить</button>
              )}
            </div>
          </article>
        ))}
      </div>

      {scheduleUserId && (
        <section className="card stack" data-testid="staff-schedule">
          <div className="row between">
            <h2>Расписание · {nameByUser[scheduleUserId] || 'Мастер'}</h2>
            <button className="btn btn-secondary btn-compact" type="button" onClick={() => setScheduleUserId(null)}>Закрыть</button>
          </div>
          <p className="muted">Рабочие часы по дням недели. Если есть записи вне новых часов, изменение будет отклонено.</p>
          {hoursQ.isLoading && <div className="state-box">Загрузка часов…</div>}
          {hoursDraft.map((h) => (
            <div className="row" key={h.weekday}>
              <label className="field-check" style={{ minWidth: 72 }}>
                <input type="checkbox" checked={h.enabled} onChange={(e) => setHoursDraft((cur) => cur.map((x) => x.weekday === h.weekday ? { ...x, enabled: e.target.checked } : x))} />
                <span>{WEEKDAYS[h.weekday]}</span>
              </label>
              <input type="time" value={h.start} disabled={!h.enabled} onChange={(e) => setHoursDraft((cur) => cur.map((x) => x.weekday === h.weekday ? { ...x, start: e.target.value } : x))} />
              <input type="time" value={h.end} disabled={!h.enabled} onChange={(e) => setHoursDraft((cur) => cur.map((x) => x.weekday === h.weekday ? { ...x, end: e.target.value } : x))} />
            </div>
          ))}
          <button className="btn btn-primary" type="button" disabled={saveHours.isPending} onClick={() => saveHours.mutate()}>Сохранить часы</button>
          <div className="field">
            <label>Выходной (ваш календарь)</label>
            <input type="date" value={dayOff} onChange={(e) => setDayOff(e.target.value)} />
          </div>
          <button className="btn btn-secondary" type="button" disabled={!dayOff || saveDayOff.isPending} onClick={() => saveDayOff.mutate()}>Добавить выходной</button>
        </section>
      )}
    </main>
  )
}

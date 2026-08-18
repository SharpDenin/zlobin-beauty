import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { apiRequest, ApiError } from '@/shared/api/client'
import { hasMasterAccess, useAuth } from '@/features/auth/AuthProvider'
import { formatMoney } from '@/shared/lib/money'
import { useState } from 'react'
import { VisitSchemeSummary } from '@/features/scheme/VisitSchemeSummary'

type ClientCard = {
  id: string
  organization_id: string
  user_id: string
  display_name: string
  phone: string | null
  email: string | null
  preferences: string
}

type Visit = {
  id: string
  service_name: string
  price_minor: number
  completed_at: string
  appointment_id: string
}

type Formula = {
  id: string
  name: string
  brand: string
  oxidizer: string
  ratio: string
  comment: string
  created_at: string
  components?: Array<{ label?: string; amount?: string } | string>
}

const noteSchema = z.object({
  visit_id: z.string().min(1, 'Выберите визит'),
  body: z.string().min(2, 'Введите заметку'),
})

const formulaSchema = z.object({
  name: z.string().min(2, 'Укажите название'),
  brand: z.string().optional(),
  components_text: z.string().min(2, 'Укажите состав'),
  oxidizer: z.string().optional(),
  ratio: z.string().optional(),
  comment: z.string().optional(),
})

function formulaComponents(f: Formula): string[] {
  if (!f.components || f.components.length === 0) return []
  return f.components.map((c) => {
    if (typeof c === 'string') return c
    return [c.label, c.amount].filter(Boolean).join(' ')
  }).filter(Boolean)
}

export function ClientCardPage() {
  const { id, appointmentId } = useParams()
  const { accessToken, user } = useAuth()
  const canMaster = hasMasterAccess(user)
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const cardQuery = useQuery({
    queryKey: ['client', id, appointmentId],
    queryFn: async () => {
      if (appointmentId) {
        return apiRequest<ClientCard>(`/v1/clients/appointment/${appointmentId}`, { token: accessToken })
      }
      return apiRequest<ClientCard>(`/v1/clients/id/${id}`, { token: accessToken })
    },
    enabled: Boolean(accessToken && (id || appointmentId)),
    retry: false,
  })

  const cardId = cardQuery.data?.id
  const clientUserId = cardQuery.data?.user_id
  const visits = useQuery({
    queryKey: ['client-visits', cardId],
    queryFn: () => apiRequest<{ items: Visit[] }>(`/v1/clients/id/${cardId}/visits`, { token: accessToken }),
    enabled: Boolean(cardId && accessToken),
  })
  const formulas = useQuery({
    queryKey: ['client-formulas', cardId],
    queryFn: () => apiRequest<{ items: Formula[] }>(`/v1/clients/id/${cardId}/formulas`, { token: accessToken }),
    enabled: Boolean(cardId && accessToken),
  })
  const autoConfirm = useQuery({
    queryKey: ['client-auto-confirm', clientUserId],
    queryFn: () =>
      apiRequest<{ auto_confirm: boolean }>(`/v1/me/clients/${clientUserId}/auto-confirm`, {
        token: accessToken,
      }),
    enabled: Boolean(canMaster && clientUserId && accessToken),
  })
  const blacklist = useQuery({
    queryKey: ['client-blacklist', clientUserId],
    queryFn: () =>
      apiRequest<{ blocked: boolean; no_show_count: number }>(`/v1/me/clients/${clientUserId}/blacklist`, {
        token: accessToken,
      }),
    enabled: Boolean(canMaster && clientUserId && accessToken),
  })
  const setAutoConfirm = useMutation({
    mutationFn: (auto_confirm: boolean) =>
      apiRequest(`/v1/me/clients/${clientUserId}/auto-confirm`, {
        method: 'PUT',
        token: accessToken,
        body: { auto_confirm },
      }),
    onSuccess: async () => {
      setOk('Автоподтверждение обновлено')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['client-auto-confirm', clientUserId] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось сохранить'),
  })

  const unblock = useMutation({
    mutationFn: () =>
      apiRequest(`/v1/me/clients/${clientUserId}/unblock`, {
        token: accessToken,
      }),
    onSuccess: async () => {
      setOk('Клиент разблокирован')
      setError(null)
      await qc.invalidateQueries({ queryKey: ['client-blacklist', clientUserId] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Не удалось разблокировать'),
  })

  const noteForm = useForm<z.infer<typeof noteSchema>>({ resolver: zodResolver(noteSchema) })
  const formulaForm = useForm<z.infer<typeof formulaSchema>>({ resolver: zodResolver(formulaSchema) })

  const saveNote = useMutation({
    mutationFn: (v: z.infer<typeof noteSchema>) =>
      apiRequest(`/v1/clients/id/${cardId}/notes`, { token: accessToken, body: v }),
    onSuccess: async () => {
      setOk('Заметка сохранена')
      setError(null)
      noteForm.reset()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка заметки'),
  })

  const saveFormula = useMutation({
    mutationFn: (v: z.infer<typeof formulaSchema>) =>
      apiRequest(`/v1/clients/id/${cardId}/formulas`, {
        token: accessToken,
        body: {
          name: v.name,
          brand: v.brand ?? '',
          components: v.components_text.split(',').map((s) => s.trim()).filter(Boolean).map((label) => ({ label })),
          oxidizer: v.oxidizer ?? '',
          ratio: v.ratio ?? '',
          comment: v.comment ?? '',
        },
      }),
    onSuccess: async () => {
      setOk('Состав сохранён')
      setError(null)
      formulaForm.reset()
      await qc.invalidateQueries({ queryKey: ['client-formulas', cardId] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Ошибка состава'),
  })

  if (cardQuery.isLoading) return <div className="page state-box">Загрузка карточки…</div>
  if (cardQuery.isError || !cardQuery.data) {
    return <div className="page state-box error">Карточка клиента недоступна. Завершите визит, чтобы она появилась.</div>
  }

  const card = cardQuery.data

  return (
    <main className="page stack">
      <section className="hero">
        <div className="stack">
          <h1>{card.display_name}</h1>
          <p>{card.phone || card.email || 'Контакты не указаны'}</p>
          {card.preferences && <p className="muted">Предпочтения: {card.preferences}</p>}
        </div>
      </section>

      {error && <div className="state-box error">{error}</div>}
      {ok && <div className="state-box success">{ok}</div>}

      {canMaster && (
        <section className="card stack">
          <h2>Автоподтверждение записей</h2>
          <p className="muted">Новые записи этого клиента будут подтверждаться автоматически.</p>
          {autoConfirm.data && (
            <label className="field-check">
              <input
                type="checkbox"
                checked={autoConfirm.data.auto_confirm}
                disabled={setAutoConfirm.isPending}
                onChange={(e) => setAutoConfirm.mutate(e.target.checked)}
              />
              <span>Автоподтверждение для этого клиента</span>
            </label>
          )}
        </section>
      )}

      {canMaster && card.user_id && (
        <section className="card stack">
          <h2>Чёрный список (no-show)</h2>
          <p className="muted">
            No-show: {blacklist.data?.no_show_count ?? 0} · статус:{' '}
            {blacklist.data?.blocked ? 'заблокирован' : 'доступна запись'}
          </p>
          {blacklist.data?.blocked && (
            <button
              className="btn btn-secondary"
              type="button"
              disabled={unblock.isPending}
              onClick={() => unblock.mutate()}
            >
              Разблокировать клиента
            </button>
          )}
        </section>
      )}

      <section className="stack">
        <h2>История посещений</h2>
        {visits.isLoading && <div className="state-box">Загрузка…</div>}
        {visits.data && visits.data.items.length === 0 && <div className="empty-state"><h2>Посещений пока нет</h2></div>}
        <div className="list">
          {visits.data?.items.map((v) => (
            <article key={v.id} className="history-card">
              <div className="row between">
                <strong>{v.service_name}</strong>
                <span>{formatMoney(v.price_minor)}</span>
              </div>
              <p className="muted">{new Date(v.completed_at).toLocaleString('ru-RU')}</p>
              <VisitSchemeSummary appointmentId={v.appointment_id} accessToken={accessToken} />
            </article>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h2>Заметка</h2>
        <form className="stack" onSubmit={noteForm.handleSubmit((v) => saveNote.mutate(v))}>
          <div className="field">
            <label htmlFor="visit_id">Визит</label>
            <select id="visit_id" aria-invalid={Boolean(noteForm.formState.errors.visit_id)} {...noteForm.register('visit_id')}>
              <option value="">Выберите</option>
              {visits.data?.items.map((v) => (
                <option key={v.id} value={v.id}>{v.service_name} · {new Date(v.completed_at).toLocaleDateString('ru-RU')}</option>
              ))}
            </select>
            {noteForm.formState.errors.visit_id && <span className="error">{noteForm.formState.errors.visit_id.message}</span>}
          </div>
          <div className="field">
            <label htmlFor="body">Текст</label>
            <textarea id="body" aria-invalid={Boolean(noteForm.formState.errors.body)} {...noteForm.register('body')} />
            {noteForm.formState.errors.body && <span className="error">{noteForm.formState.errors.body.message}</span>}
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={saveNote.isPending}>Сохранить заметку</button>
        </form>
      </section>

      <section className="stack">
        <h2>Составы окрашивания</h2>
        {formulas.data && formulas.data.items.length === 0 && (
          <div className="empty-state"><h2>Составов пока нет</h2></div>
        )}
        <div className="list">
          {formulas.data?.items.map((f) => {
            const comps = formulaComponents(f)
            return (
              <article key={f.id} className="formula-card">
                <div className="row between">
                  <strong>{f.name}</strong>
                  <span className="muted">{new Date(f.created_at).toLocaleDateString('ru-RU')}</span>
                </div>
                <div className="formula-grid">
                  <div className="formula-field"><span>Бренд</span><strong>{f.brand || '—'}</strong></div>
                  <div className="formula-field"><span>Окислитель</span><strong>{f.oxidizer || '—'}</strong></div>
                  <div className="formula-field"><span>Пропорция</span><strong>{f.ratio || '—'}</strong></div>
                  <div className="formula-field"><span>Компоненты</span><strong>{comps.join(', ') || '—'}</strong></div>
                </div>
                {f.comment && <p>{f.comment}</p>}
              </article>
            )
          })}
        </div>
        <form className="card stack" onSubmit={formulaForm.handleSubmit((v) => saveFormula.mutate(v))}>
          <h3>Новый состав</h3>
          <div className="field"><label>Название</label><input {...formulaForm.register('name')} /></div>
          <div className="field"><label>Бренд</label><input {...formulaForm.register('brand')} /></div>
          <div className="field"><label>Компоненты через запятую</label><input {...formulaForm.register('components_text')} placeholder="8.1 30g, 9.13 20g" /></div>
          <div className="field"><label>Окислитель</label><input {...formulaForm.register('oxidizer')} /></div>
          <div className="field"><label>Пропорция</label><input {...formulaForm.register('ratio')} placeholder="1:2" /></div>
          <div className="field"><label>Комментарий</label><textarea {...formulaForm.register('comment')} /></div>
          <button className="btn btn-primary btn-block" type="submit" disabled={saveFormula.isPending}>Сохранить состав</button>
        </form>
      </section>
    </main>
  )
}
